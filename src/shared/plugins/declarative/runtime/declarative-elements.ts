/** JSX element factory for the guest `occ` module. Elements are plain data until rendered. */

export const OCC_ELEMENT = Symbol.for('occ.declarative.element')
export const Fragment = Symbol.for('occ.declarative.fragment')

export type OCCProps = Record<string, unknown>
/** Loosely typed on purpose: author-facing prop types live in the published `occ` typings. */
export type OCCComponent = (props: OCCProps) => unknown
export type OCCElementType = string | typeof Fragment | OCCComponent

export type OCCElement = {
  readonly $$typeof: typeof OCC_ELEMENT
  readonly type: OCCElementType
  readonly props: OCCProps
  readonly key: string | undefined
}

export function isOCCElement(value: unknown): value is OCCElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    value.$$typeof === OCC_ELEMENT
  )
}

function createElement(type: OCCElementType, props: OCCProps, key: unknown): OCCElement {
  return Object.freeze({
    $$typeof: OCC_ELEMENT,
    type,
    props,
    key: key === undefined || key === null ? undefined : String(key)
  })
}

/** Automatic runtime (`jsx`/`jsxs`/`jsxDEV`): children arrive inside `props`. */
export function jsx(type: OCCElementType, props: OCCProps | null, key?: unknown): OCCElement {
  const { key: propKey, ...rest } = props ?? {}
  return createElement(type, rest, key ?? propKey)
}

/** Classic runtime (`h`, `jsxFactory`): children arrive as trailing arguments. */
export function h(
  type: OCCElementType,
  props: OCCProps | null,
  ...children: unknown[]
): OCCElement {
  const { key, ...rest } = props ?? {}
  if (children.length > 0) {
    rest.children = children.length === 1 ? children[0] : children
  }
  return createElement(type, rest, key)
}
