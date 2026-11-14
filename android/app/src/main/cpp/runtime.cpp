#include <jni.h>
#include <node.h>
#include <unistd.h>
#include <cstdlib>
#include <cstdio>
#include <string>
#include <vector>
#include <thread>
#include <sys/stat.h>

static std::string utf8(JNIEnv* env, jstring value) {
    const jchar* chars = env->GetStringChars(value, nullptr);
    const jsize length = env->GetStringLength(value);
    std::string result;
    for (jsize i = 0; i < length; ++i) {
        unsigned int cp = chars[i];
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < length && chars[i + 1] >= 0xDC00 && chars[i + 1] <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (chars[++i] - 0xDC00);
        } else if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;
        if (cp < 0x80) result.push_back(static_cast<char>(cp));
        else if (cp < 0x800) {
            result.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            result.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            result.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    env->ReleaseStringChars(value, chars);
    return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_io_github_alexbeatsz_webobsidian_RuntimeHost_startNode(JNIEnv* env, jclass, jobjectArray arguments, jobjectArray variables, jstring directory, jstring logPath) {
    for (jsize i = 0; i < env->GetArrayLength(variables); ++i) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(variables, i));
        const auto entry = utf8(env, value);
        const auto split = entry.find('=');
        if (split != std::string::npos) setenv(entry.substr(0, split).c_str(), entry.substr(split + 1).c_str(), 1);
        env->DeleteLocalRef(value);
    }
    if (chdir(utf8(env, directory).c_str()) != 0) return -1;
    const auto log = utf8(env, logPath);
    int descriptors[2];
    if (pipe(descriptors) != 0) return -2;
    if (dup2(descriptors[1], STDOUT_FILENO) < 0 || dup2(descriptors[1], STDERR_FILENO) < 0) {
        close(descriptors[0]); close(descriptors[1]); return -2;
    }
    close(descriptors[1]);
    std::thread([log, input = descriptors[0]] {
        FILE* output = fopen(log.c_str(), "ab");
        struct stat state{};
        size_t size = stat(log.c_str(), &state) == 0 ? static_cast<size_t>(state.st_size) : 0;
        constexpr size_t limit = 4 * 1024 * 1024;
        char buffer[16384];
        ssize_t count;
        while ((count = read(input, buffer, sizeof(buffer))) > 0) {
            if (!output) continue;
            if (size + static_cast<size_t>(count) > limit) {
                fclose(output);
                const auto previous = log + ".1";
                remove(previous.c_str());
                rename(log.c_str(), previous.c_str());
                output = fopen(log.c_str(), "wb");
                size = 0;
            }
            if (output) { size += fwrite(buffer, 1, static_cast<size_t>(count), output); fflush(output); }
        }
        if (output) fclose(output);
        close(input);
    }).detach();
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IOLBF, 0);
    // libuv rewrites argv: own one contiguous, writable buffer for its lifetime.
    std::vector<std::string> values;
    size_t length = 0;
    for (jsize i = 0; i < env->GetArrayLength(arguments); ++i) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        values.push_back(utf8(env, value)); length += values.back().size() + 1;
        env->DeleteLocalRef(value);
    }
    std::vector<char> storage(length);
    std::vector<char*> argv;
    size_t offset = 0;
    for (const auto& value : values) {
        argv.push_back(storage.data() + offset);
        value.copy(storage.data() + offset, value.size());
        offset += value.size() + 1;
    }
    return node::Start(static_cast<int>(argv.size()), argv.data());
}
