import { assertValidHandle, hostnamesForHandle, RESERVED_HANDLES } from "../platform-config"

describe("store handle and platform hostname rules (ADR-018)", () => {
  const original = process.env.PLATFORM_BASE_DOMAIN
  afterEach(() => {
    process.env.PLATFORM_BASE_DOMAIN = original
  })

  it.each(["maria-candles", "petya-jewellery", "abc", "a1b2c3"])("accepts %s", (handle) => {
    expect(assertValidHandle(handle)).toBe(handle)
  })

  it.each([
    "Maria",
    "ma",
    "-maria",
    "maria-",
    "maria--candles",
    "maria.candles",
    "maria_candles",
    "x".repeat(41),
    "",
    123,
    undefined,
    ...RESERVED_HANDLES,
  ])("rejects %p", (handle) => {
    expect(() => assertValidHandle(handle)).toThrow(/Store handle/)
  })

  it("derives distinct, normalised live and preview hostnames under the platform domain", () => {
    process.env.PLATFORM_BASE_DOMAIN = "Shops.Test."
    expect(hostnamesForHandle("maria-candles")).toEqual({
      live: "maria-candles.shops.test",
      preview: "maria-candles.preview.shops.test",
    })
    process.env.PLATFORM_BASE_DOMAIN = "localhost"
    const { live, preview } = hostnamesForHandle("petya-jewellery")
    expect(live).toBe("petya-jewellery.localhost")
    expect(preview).toBe("petya-jewellery.preview.localhost")
    expect(live).not.toBe(preview)
  })

  it("rejects an invalid platform domain", () => {
    process.env.PLATFORM_BASE_DOMAIN = "not a domain/"
    expect(() => hostnamesForHandle("maria-candles")).toThrow(/PLATFORM_BASE_DOMAIN/)
  })
})
