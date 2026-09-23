type Consumer = {signal?: AbortSignal}
type Task<T> = {
  priority: number
  started: boolean
  consumers: Set<Consumer>
  run: () => Promise<T | undefined>
  promise: Promise<T | undefined>
  resolve: (value: T | undefined) => void
  reject: (error: unknown) => void
}

/** Shared work, but caller-owned interest: unmounting a preview cannot cancel a visible message. */
export const createDmDecryptionQueue = <T>(concurrency = 2) => {
  const tasks = new Map<string, Task<T>>()
  let active = 0
  const pump = () => {
    while (active < concurrency) {
      const entry = Array.from(tasks)
        .filter(([, task]) => !task.started && task.consumers.size)
        .sort((a, b) => b[1].priority - a[1].priority)[0]
      if (!entry) return
      const [key, task] = entry
      task.started = true
      active++
      void Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          if (tasks.get(key) === task) tasks.delete(key)
          active--
          pump()
        })
    }
  }
  return (
    key: string,
    run: () => Promise<T | undefined>,
    options: {
      priority?: number
      signal?: AbortSignal
    } = {},
  ) => {
    if (options.signal?.aborted) return Promise.resolve(undefined)
    let task = tasks.get(key)
    if (!task) {
      let resolve!: Task<T>["resolve"], reject!: Task<T>["reject"]
      const promise = new Promise<T | undefined>((yes, no) => {
        resolve = yes
        reject = no
      })
      task = {
        priority: options.priority || 0,
        started: false,
        consumers: new Set(),
        run,
        promise,
        resolve,
        reject,
      }
      tasks.set(key, task)
    }
    task.priority = Math.max(task.priority, options.priority || 0)
    const consumer = {signal: options.signal}
    task.consumers.add(consumer)
    const owned = task
    const result = new Promise<T | undefined>((resolve, reject) => {
      const release = () => {
        options.signal?.removeEventListener("abort", abort)
        owned.consumers.delete(consumer)
        if (!owned.started && !owned.consumers.size) {
          if (tasks.get(key) === owned) tasks.delete(key)
          owned.resolve(undefined)
        }
      }
      const abort = () => {
        release()
        resolve(undefined)
      }
      options.signal?.addEventListener("abort", abort, {once: true})
      owned.promise.then(
        value => {
          release()
          resolve(value)
        },
        error => {
          release()
          reject(error)
        },
      )
    })
    queueMicrotask(pump)
    return result
  }
}
