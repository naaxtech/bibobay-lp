import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotCheckSlot } from "@/components/forms/bot-check/BotCheckSlot";
import { resetTurnstileLoaderForTests } from "@/components/forms/bot-check/load-turnstile";
import { useBotCheck, type BotCheckHandle } from "@/components/forms/bot-check/useBotCheck";

import { fire, installFakeTurnstile, turnstileScripts, type FakeTurnstile } from "./support";

const URL_R217 =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__bibobayTurnstileOnload";

let fake: FakeTurnstile;

function first() {
  const render = fake.renders[0];
  if (!render) throw new Error("nothing rendered");
  return render;
}

function firstScript() {
  const script = turnstileScripts()[0];
  if (!script) throw new Error("no script injected");
  return script;
}

function options0() {
  return first().options;
}

function Host({ siteKey, onHandle }: { siteKey: string | null; onHandle: (h: BotCheckHandle) => void }) {
  const handle = useBotCheck(siteKey, "contact");
  onHandle(handle);
  return <BotCheckSlot enabled={handle.enabled} containerRef={handle.containerRef} />;
}

function mount(siteKey: string | null = "site-key", width = 320) {
  const handles: BotCheckHandle[] = [];
  const view = render(<Host siteKey={siteKey} onHandle={(h) => handles.push(h)} />);
  const container = view.container.querySelector<HTMLDivElement>(".bot-check");
  if (container) Object.defineProperty(container, "clientWidth", { configurable: true, value: width });
  return { view, handle: (): BotCheckHandle => {
      const latest = handles.at(-1);
      if (!latest) throw new Error("the host has not rendered");
      return latest;
    }, container };
}

async function ready() {
  await act(async () => {
    window.__bibobayTurnstileOnload?.();
  });
}

beforeEach(() => {
  resetTurnstileLoaderForTests();
  fake = installFakeTurnstile();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.turnstile;
  resetTurnstileLoaderForTests();
});

describe("no script until prepare", () => {
  it("adds nothing on render, one script on the first prepare, none on the second", () => {
    const nonceScript = document.createElement("script");
    nonceScript.setAttribute("nonce", "abc123");
    document.body.append(nonceScript);
    const { handle } = mount();
    expect(turnstileScripts()).toHaveLength(0);
    act(() => handle().prepare());
    const scripts = turnstileScripts();
    const script = firstScript();
    expect(scripts).toHaveLength(1);
    expect(script.getAttribute("src")).toBe(URL_R217);
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
    expect(script.nonce || script.getAttribute("nonce")).toBe("abc123");
    act(() => handle().prepare());
    expect(turnstileScripts()).toHaveLength(1);
  });
});

describe("render options", () => {
  it.each([
    [280, "compact"],
    [320, "flexible"],
  ])("renders with the R217 options at %i px (%s)", async (width, size) => {
    const { handle, container } = mount("site-key", width);
    act(() => handle().prepare());
    await ready();
    expect(fake.renders).toHaveLength(1);
    expect(first().el).toBe(container);
    expect(options0()).toMatchObject({
      sitekey: "site-key",
      action: "contact",
      appearance: "interaction-only",
      execution: "render",
      theme: "light",
      language: "auto",
      "refresh-expired": "auto",
      "response-field": false,
      size,
    });
  });
});

describe("token()", () => {
  it("token waits for the callback", async () => {
    const { handle } = mount();
    act(() => handle().prepare());
    await ready();
    const pending = handle().token();
    await act(async () => {
      fire(options0(), "callback", "t1");
    });
    await expect(pending).resolves.toEqual({ token: "t1" });
    await expect(handle().token()).resolves.toEqual({ token: "t1" });
  });

  it("expired then renewed waits for the next token", async () => {
    const { handle } = mount();
    act(() => handle().prepare());
    await ready();
    const options = options0();
    await act(async () => {
      fire(options, "callback", "t1");
      fire(options, "expired-callback");
    });
    const pending = handle().token();
    await act(async () => {
      fire(options, "callback", "t2");
    });
    await expect(pending).resolves.toEqual({ token: "t2" });
  });

  it("interactive resolves at once when there is no token", async () => {
    const { handle } = mount();
    act(() => handle().prepare());
    await ready();
    const options = options0();
    await act(async () => {
      fire(options, "before-interactive-callback");
    });
    await expect(handle().token()).resolves.toEqual({ problem: "interactive" });
    await act(async () => {
      fire(options, "after-interactive-callback");
      fire(options, "callback", "t9");
    });
    await expect(handle().token()).resolves.toEqual({ token: "t9" });
  });

  it("interactive releases a submit that was already waiting", async () => {
    const { handle } = mount();
    act(() => handle().prepare());
    await ready();
    const pending = handle().token();
    await act(async () => {
      fire(options0(), "before-interactive-callback");
    });
    await expect(pending).resolves.toEqual({ problem: "interactive" });
  });

  it("script error gives unavailable, and a later prepare retries", async () => {
    const { handle } = mount();
    act(() => handle().prepare());
    const pending = handle().token();
    await act(async () => {
      firstScript().dispatchEvent(new Event("error"));
    });
    await expect(pending).resolves.toEqual({ problem: "unavailable" });
    await expect(handle().token()).resolves.toEqual({ problem: "unavailable" });
    act(() => handle().prepare());
    expect(turnstileScripts()).toHaveLength(1);
    await ready();
    expect(fake.renders).toHaveLength(1);
  });

  it("load timeout gives unavailable after 15 s, and a later prepare retries", async () => {
    vi.useFakeTimers();
    const { handle } = mount();
    act(() => handle().prepare());
    const pending = handle().token();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await expect(pending).resolves.toEqual({ problem: "unavailable" });
    act(() => handle().prepare());
    expect(turnstileScripts()).toHaveLength(1);
  });

  it("a widget that never answers times out after 15 s", async () => {
    vi.useFakeTimers();
    const { handle } = mount();
    act(() => handle().prepare());
    await ready();
    const pending = handle().token();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await expect(pending).resolves.toEqual({ problem: "unavailable" });
  });

  it("error-callback returns true and makes the token unavailable", async () => {
    const { handle } = mount();
    act(() => handle().prepare());
    await ready();
    let returned: unknown;
    await act(async () => {
      returned = fire(options0(), "error-callback", "110200");
    });
    expect(returned).toBe(true);
    await expect(handle().token()).resolves.toEqual({ problem: "unavailable" });
  });
});

describe("reset, unmount, disabled", () => {
  it("reset calls turnstile.reset(id) and clears the token; unmount calls remove(id)", async () => {
    const { handle, view } = mount();
    act(() => handle().prepare());
    await ready();
    await act(async () => {
      fire(options0(), "callback", "t1");
    });
    act(() => handle().reset());
    expect(fake.resets).toEqual(["w1"]);
    const pending = handle().token();
    await act(async () => {
      fire(options0(), "callback", "t2");
    });
    await expect(pending).resolves.toEqual({ token: "t2" });
    view.unmount();
    expect(fake.removes).toEqual(["w1"]);
  });

  it("does not render into a form that unmounted before the script loaded", async () => {
    const { handle, view } = mount();
    act(() => handle().prepare());
    view.unmount();
    await ready();
    expect(fake.renders).toHaveLength(0);
  });

  it("disabled: a null site key is not enabled and prepare does nothing", () => {
    const { result } = renderHook(() => useBotCheck(null, "lead"));
    expect(result.current.enabled).toBe(false);
    act(() => result.current.prepare());
    expect(turnstileScripts()).toHaveLength(0);
  });

  it("the slot renders nothing when the check is off", () => {
    const { view } = mount(null);
    expect(view.container.querySelector(".bot-check")).toBeNull();
  });

  it("the slot has no live region", () => {
    const { view } = mount();
    expect(view.container.querySelector("[role], [aria-live]")).toBeNull();
  });
});
