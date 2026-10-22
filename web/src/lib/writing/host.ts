/** Small lifecycle utility used by delayed source concealment. */
export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number, reset = true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = (...args: Parameters<T>) => {
    if (timer && reset) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  };
  call.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return call;
}
