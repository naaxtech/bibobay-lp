import { describe, expect, it } from "vitest";

import { ISO_COUNTRY_CODES, countryOptions, isCountryCode, orderCountryCodes } from "@/lib/orders/countries";

/*
 * Ruling R85: the order form lists the countries an editor names in the CMS (`orderCountries`), or
 * every country when the list is empty; staff quote freight per request. The list is ISO 3166-1
 * alpha-2 as assigned, and the names come from the browser's own Intl data, in English.
 */
describe("the repository country list", () => {
  it("holds every assigned ISO 3166-1 alpha-2 code once, in capitals", () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(ISO_COUNTRY_CODES.length);
    for (const code of ISO_COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    for (const code of ["AU", "GB", "NZ", "PH", "SG", "US", "AX", "ZW"]) expect(isCountryCode(code), code).toBe(true);
  });

  it("leaves out codes that are reserved, user-assigned or not countries", () => {
    for (const code of ["UK", "EU", "UN", "ZZ", "XK", "EZ", "QO", "ph", "", "PHL"]) expect(isCountryCode(code), code).toBe(false);
    expect(isCountryCode(7)).toBe(false);
  });

  it("has an English name for every code", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const code of ISO_COUNTRY_CODES) expect(names.of(code), code).not.toBe(code);
  });
});

describe("the countries an order may name", () => {
  it("are the CMS list when one is set, else every country", () => {
    expect(orderCountryCodes(["PH", "AU"])).toEqual(["PH", "AU"]);
    expect(orderCountryCodes([])).toEqual([...ISO_COUNTRY_CODES]);
  });

  it("are offered by English name, in alphabetical order, with no country chosen for the visitor", () => {
    expect(countryOptions(["PH", "AU", "GB"])).toEqual([
      { code: "AU", name: "Australia" },
      { code: "PH", name: "Philippines" },
      { code: "GB", name: "United Kingdom" },
    ]);
    expect(countryOptions(orderCountryCodes([]))).toHaveLength(249);
  });
});
