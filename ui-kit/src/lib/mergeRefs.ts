/** One ref callback that feeds several refs (a component's own ref and a hook's). */
export function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (el) => {
    for (const r of refs) {
      if (typeof r === 'function') r(el)
      else if (r) (r as React.MutableRefObject<T | null>).current = el
    }
  }
}
