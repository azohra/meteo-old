/* Ambient defaults without a framework: a bubbling context-request event
 * (the community-protocol shape, no dependency). A consumer dispatches
 * `meteo-context-request` with a key; the nearest provider for that key
 * answers via the callback and stops propagation, so nearest-provider-wins
 * falls out of event bubbling — and a provider answering only its OWN key
 * lets requests for other keys pass through to outer providers.
 *
 * Upgrade order is handled structurally: providers are defined before
 * consumers in defineMeteoElements (so an ancestor's listener exists by the
 * time a descendant connects — within one tree insertion an ancestor always
 * connects first), and consumers re-request on every connectedCallback so
 * re-parenting re-resolves. */

export const CONTEXT_REQUEST_EVENT = "meteo-context-request";

export type ContextProvision<T> = {
  getValue(): T;
  subscribe(listener: () => void): () => void;
};

type ContextRequestDetail = {
  key: string;
  callback: (provision: ContextProvision<unknown>) => void;
};

/* Synchronous by design: the provider's listener answers during dispatch,
 * so a null return means "no provider above me", which components treat as
 * "no ambient defaults", never as an error. */
export function requestContext<T>(from: Element, key: string): ContextProvision<T> | null {
  let provision: ContextProvision<T> | null = null;
  from.dispatchEvent(
    new CustomEvent<ContextRequestDetail>(CONTEXT_REQUEST_EVENT, {
      bubbles: true,
      composed: false,
      detail: {
        key,
        callback: (answered) => {
          provision = answered as ContextProvision<T>;
        },
      },
    }),
  );
  return provision;
}

/* Returns the teardown; the host calls it on disconnect. Requests dispatched
 * by the host ITSELF pass through untouched, so a provider can consume an
 * outer context under the same mechanism. */
export function provideContext<T>(
  host: Element,
  key: string,
  provision: ContextProvision<T>,
): () => void {
  const handler = (event: Event) => {
    const request = event as CustomEvent<ContextRequestDetail>;
    if (request.detail?.key !== key || event.target === host) return;
    event.stopPropagation();
    request.detail.callback(provision as ContextProvision<unknown>);
  };
  host.addEventListener(CONTEXT_REQUEST_EVENT, handler);
  return () => host.removeEventListener(CONTEXT_REQUEST_EVENT, handler);
}
