#include <jni.h>
#include <node.h>
#include <unistd.h>
#include <cstdlib>
#include <cstdio>
#include <string>
#include <vector>

static std::string utf8(JNIEnv* env, jstring value) {
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
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
    freopen(log.c_str(), "a", stdout);
    freopen(log.c_str(), "a", stderr);
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
