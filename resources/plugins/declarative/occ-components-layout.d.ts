// OCC components panel catalog 2 (since OCC 1.4.247) and later: layout and feedback components.
// Part of the `occ` module with occ.d.ts, occ-components.d.ts and occ-components-data.d.ts.

declare module 'occ' {
  import type { Align, Gap, IconName, Leaf, OCCComponent, Tone, WithChildren } from 'occ'

  /** Holds only `Tab`; OCC draws the selected tab's children. */
  export type TabsProps = WithChildren & {
    label: string
    value?: string
    defaultValue?: string
    onChange?: (value: string) => void
  }
  export type TabProps = WithChildren & {
    value: string
    label: string
    icon?: IconName
    disabled?: boolean
  }
  export type CollapsibleProps = WithChildren & {
    title: string
    description?: string
    open?: boolean
    defaultOpen?: boolean
    disabled?: boolean
    onChange?: (open: boolean) => void
  }
  /** A row of controls; arrow keys move between them. */
  export type ToolbarProps = WithChildren & { label: string; gap?: Gap }
  export type GridProps = WithChildren & {
    columns?: 1 | 2 | 3 | 4 | 5 | 6
    /** As many columns as fit, each at least this wide; overrides `columns`. */
    minItemWidth?: 'xs' | 'sm' | 'md' | 'lg'
    gap?: Gap
  }
  export type CalloutProps = WithChildren & { tone?: Tone; title?: string; icon?: IconName }
  /** A placeholder while content loads; `label` names it for screen readers. */
  export type SkeletonProps = Leaf & {
    shape?: 'text' | 'block' | 'circle'
    lines?: number
    label?: string
  }

  /** Pixels (0 to 4096) or a whole percent of the parent, such as `'50%'`. */
  export type BoxLength = number | `${number}%`
  /**
   * Since 1.4.248 (`ui.catalog` 4): a general layout container that follows the theme. A column
   * unless `direction="row"` or `columns` (equal grid columns) is set. Spacing uses the gap scale.
   */
  export type BoxProps = WithChildren & {
    direction?: 'row' | 'column'
    gap?: Gap
    padding?: Gap
    /** Overrides `padding` left and right. */
    paddingX?: Gap
    /** Overrides `padding` top and bottom. */
    paddingY?: Gap
    margin?: Gap
    align?: Align
    justify?: 'start' | 'center' | 'end' | 'between'
    wrap?: boolean
    /** Takes the free space in a row or column. */
    grow?: boolean
    /** `false` keeps its size when space runs out. */
    shrink?: boolean
    width?: BoxLength
    height?: BoxLength
    minWidth?: BoxLength
    minHeight?: BoxLength
    maxWidth?: BoxLength
    maxHeight?: BoxLength
    columns?: 1 | 2 | 3 | 4 | 5 | 6
    /** Scrolls its own content past its size (set `height` or `maxHeight` for `y`). */
    scroll?: 'x' | 'y' | 'both'
    /** `true` draws the hairline border; a tone colours it. */
    border?: boolean | Tone
    radius?: 'none' | 'sm' | 'md' | 'lg' | 'full'
    /** A theme surface, or a tint of a tone. */
    background?: 'none' | 'muted' | 'card' | Tone
  }

  export const Tabs: OCCComponent<TabsProps>
  export const Tab: OCCComponent<TabProps>
  export const Collapsible: OCCComponent<CollapsibleProps>
  export const Toolbar: OCCComponent<ToolbarProps>
  export const Grid: OCCComponent<GridProps>
  export const Callout: OCCComponent<CalloutProps>
  export const Skeleton: OCCComponent<SkeletonProps>
  export const Box: OCCComponent<BoxProps>
}
