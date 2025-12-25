/* eslint prefer-rest-params: 0 */

import {page} from "$app/stores"
import {getSetting} from "@app/core/state"

const w = window as any

w.plausible =
  w.plausible ||
  function () {
    ;(w.plausible.q = w.plausible.q || []).push(arguments)
  }

export const setupAnalytics = () =>
  page.subscribe($page => {
    if ($page.route?.id && getSetting("report_usage")) {
      const routeId = $page.route.id
      
      // Skip localhost, root, and invalid routes
      if (routeId === "localhost" || 
          routeId === "/" || 
          routeId.includes("localhost") ||
          !routeId ||
          routeId === "undefined") {
        return
      }
      
      try {
        w.plausible("pageview", {u: routeId})
      } catch (error) {
        console.warn("Analytics error:", error)
      }
    }
  })
