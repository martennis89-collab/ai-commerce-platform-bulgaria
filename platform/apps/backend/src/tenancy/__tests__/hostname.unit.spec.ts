import { normalizeHostname } from "../hostname"

describe("normalizeHostname (StoreEnvironment hostname resolution input)", () => {
  it("normalises case, port and trailing dot to an exact hostname", () => {
    expect(normalizeHostname("Maria-Candles.Shops.Test")).toBe("maria-candles.shops.test")
    expect(normalizeHostname("maria-candles.shops.test:443")).toBe("maria-candles.shops.test")
    expect(normalizeHostname("maria-candles.shops.test.")).toBe("maria-candles.shops.test")
  })

  it.each([
    [undefined],
    [null],
    [""],
    ["maria-candles.shops.test/evil"],
    ["user@maria-candles.shops.test"],
    ["maria-candles.shops.test,petya-jewellery.shops.test"],
    ["maria-candles.shops.test:99999999"],
    ["[::1]"],
    ["-maria.shops.test"],
    ["maria_candles.shops.test"],
  ])("rejects malformed host %p", (host) => {
    expect(normalizeHostname(host as any)).toBeNull()
  })

  it("never turns a look-alike host into the registered one", () => {
    expect(normalizeHostname("maria-candles.shops.test.evil.com")).toBe(
      "maria-candles.shops.test.evil.com"
    )
    expect(normalizeHostname("evil-maria-candles.shops.test")).toBe("evil-maria-candles.shops.test")
  })
})
