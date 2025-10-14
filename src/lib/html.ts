import {sleep, last, randomId} from "@welshman/lib"
export {preventDefault, stopPropagation} from "svelte/legacy"

export const copyToClipboard = (text: string) => {
  const {activeElement} = document
  const input = document.createElement("textarea")

  input.innerHTML = text
  document.body.appendChild(input)
  input.select()

  const result = document.execCommand("copy")

  document.body.removeChild(input)
  ;(activeElement as HTMLElement).focus()

  return result
}

/**
 * Utility function to ensure DOM element is ready before executing a callback
 * Provides retry logic with exponential backoff for DOM timing issues
 */
export const whenElementReady = async <T extends HTMLElement | undefined>(
  getElement: () => T,
  callback: (element: NonNullable<T>) => void | Promise<void>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    retryMultiplier?: number;
  } = {}
): Promise<void> => {
  const {
    maxRetries = 20,
    initialDelay = 50,
    maxDelay = 1000,
    retryMultiplier = 1.5
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  const tryCallback = async (): Promise<void> => {
    const element = getElement();
    
    if (element) {
      await callback(element as NonNullable<T>);
      return;
    }

    if (attempt >= maxRetries) {
      console.warn(`Element not ready after ${maxRetries} attempts, proceeding anyway`);
      return;
    }

    attempt++;
    console.debug(`Element not ready, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
    
    await sleep(delay);
    delay = Math.min(delay * retryMultiplier, maxDelay);
    
    return tryCallback();
  };

  return tryCallback();
};

export type ScrollerOpts = {
  onScroll: () => any
  element: Element
  threshold?: number
  reverse?: boolean
  delay?: number
}

export type Scroller = {
  check: () => Promise<void>
  stop: () => void
}

export const createScroller = ({
  onScroll,
  element,
  delay = 1000,
  threshold = 2000,
  reverse = false,
}: ScrollerOpts) => {
  let done = false

  // Check if element exists before accessing classList
  if (!element) {
    console.warn('createScroller: element is null, returning no-op scroller');
    return {
      check: async () => {},
      stop: () => {}
    };
  }

  const container = element.classList.contains("scroll-container")
    ? element
    : element.closest(".scroll-container")

  const check = async () => {
    if (container) {
      // While we have empty space, fill it
      const {scrollY, innerHeight} = window
      const {scrollHeight, scrollTop} = container
      const offset = Math.abs(scrollTop || scrollY)
      const shouldLoad = offset + innerHeight + threshold > scrollHeight

      // Only trigger loading the first time we reach the threshold
      if (shouldLoad) {
        await onScroll()
      }
    }

    // No need to check all that often
    await sleep(delay)

    if (!done) {
      requestAnimationFrame(check)
    }
  }

  requestAnimationFrame(check)

  return {
    check,
    stop: () => {
      done = true
    },
  }
}

export const isMobile = "ontouchstart" in document.documentElement

export const downloadText = (filename: string, text: string) => {
  const blob = new Blob([text], {type: "text/plain"})
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")

  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const isIntersecting = async (element: Element) =>
  new Promise(resolve => {
    const observer = new IntersectionObserver(xs => {
      resolve(xs.some(x => x.isIntersecting))
      observer.unobserve(element)
    })

    observer.observe(element)
  })

export const scrollToEvent = async (id: string, attempts = 3): Promise<boolean> => {
  const element = document.querySelector(`[data-event="${id}"]`) as any
  const elements = Array.from(document.querySelectorAll("[data-event]"))

  if (element) {
    element.scrollIntoView({behavior: "smooth", block: "center"})
    element.style = "filter: brightness(1.5); transition-property: all; transition-duration: 400ms;"

    setTimeout(() => {
      element.style = "transition-property: all; transition-duration: 300ms;"
    }, 800)

    setTimeout(() => {
      element.style = ""
    }, 800 + 400)

    return true
  } else if (elements.length > 0) {
    const lastElement = last(elements)

    if (lastElement && !isIntersecting(lastElement)) {
      lastElement.scrollIntoView({behavior: "smooth", block: "center"})
    }

    await sleep(300)

    if (attempts > 0) {
      return scrollToEvent(id, attempts - 1)
    } else {
      return false
    }
  }

  return false
}

export const compressFile = async (file: File | Blob): Promise<File> => {
  const {default: Compressor} = await import("compressorjs")

  return new Promise<File>((resolve, _reject) => {
    new Compressor(file, {
      maxWidth: 2048,
      maxHeight: 2048,
      convertSize: 10 * 1024 * 1024,
      success: result => resolve(result as File),
      error: e => {
        // Non-images break compressor, return the original file
        if (e.toString().includes("File or Blob")) {
          if (file instanceof Blob) {
            file = new File([file], `${randomId()}.${file.type}`, {type: file.type})
          }

          return resolve(file as File)
        }

        _reject(e)
      },
    })
  })
}
