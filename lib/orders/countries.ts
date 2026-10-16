/**
 * The countries an order may be delivered to (ruling R85, Task 7c).
 *
 * The order form's country list is the CMS site setting `orderCountries` when an editor has set
 * one, else every country below; staff quote freight for each request, so no country is promised
 * anything by appearing here. Free of server-only code: the order page builds its options from it
 * on the server, and the server checks a submitted code against the same list.
 *
 * ISO 3166-1 alpha-2, the 249 officially assigned codes (no reserved, transitional or user-assigned
 * ones such as UK, EU or XK). studio/schemaTypes/countries.ts keeps a copy for the Studio's
 * validation; tests/content/studio-contract.test.ts fails if the two drift apart.
 */
export const ISO_COUNTRY_CODES: readonly string[] = Object.freeze([
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
]);

const ASSIGNED = new Set(ISO_COUNTRY_CODES);

/** True for an assigned ISO 3166-1 alpha-2 code, in capitals. */
export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && ASSIGNED.has(value);
}

/** The codes an order may name: the CMS list when it has any, else every country. */
export function orderCountryCodes(cms: readonly string[]): readonly string[] {
  return cms.length > 0 ? cms : ISO_COUNTRY_CODES;
}

export interface CountryOption {
  code: string;
  name: string;
}

/** Each code with its English name (the runtime's own Intl data), in alphabetical order by name. */
export function countryOptions(codes: readonly string[]): CountryOption[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const byName = new Intl.Collator("en");
  return codes.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => byName.compare(a.name, b.name));
}
