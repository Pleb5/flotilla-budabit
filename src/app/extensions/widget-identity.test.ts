import {describe, expect, it} from "vitest"
import {getWidgetLineId} from "./widget-identity"

describe("widget identity", () => {
  it("uses publisher pubkey, kind, and d identifier for widget lines", () => {
    expect(getWidgetLineId({pubkey: "A".repeat(64), identifier: "weather-widget"})).toBe(
      `30033:${"a".repeat(64)}:weather-widget`,
    )
  })

  it("falls back to the legacy identifier when pubkey is missing", () => {
    expect(getWidgetLineId({identifier: "weather-widget"})).toBe("weather-widget")
  })
})
