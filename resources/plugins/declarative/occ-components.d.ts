// OCC components panel catalog: the components `occ` exports and their props. Part of the `occ`
// module with occ.d.ts, occ-components-layout.d.ts and occ-components-data.d.ts; checked by
// plugin-declarative-typings.test.ts.

declare module 'occ' {
  import type { OCCComponent, OCCNode } from 'occ'

  export type Gap = 'none' | 'xs' | 'sm' | 'md' | 'lg'
  export type Align = 'start' | 'center' | 'end' | 'stretch'
  /** The one colour vocabulary every component shares. */
  export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  export type Size = 'xs' | 'sm' | 'md'
  export type Variant = 'solid' | 'outline' | 'ghost'
  export type Press = () => unknown
  /** The same names as a manifest panel's `icon`; any other name shows a fallback glyph. */
  export type IconName =
    | 'activity'
    | 'bar-chart-3'
    | 'bell'
    | 'blocks'
    | 'book'
    | 'bot'
    | 'bug'
    | 'calendar'
    | 'cloud'
    | 'code'
    | 'database'
    | 'file-text'
    | 'flag'
    | 'folder'
    | 'gauge'
    | 'globe'
    | 'hammer'
    | 'layers'
    | 'lightbulb'
    | 'package'
    | 'plug'
    | 'puzzle'
    | 'rocket'
    | 'star'
    | 'terminal'
    | 'wrench'
    | 'zap'
    | 'add'
    | 'remove'
    | 'delete'
    | 'edit'
    | 'refresh'
    | 'search'
    | 'settings'
    | 'check'
    | 'close'
    | 'info'
    | 'warning'
    | 'error'
    | 'open-external'
    | 'copy'
    | 'download'
    | 'upload'
    | 'play'
    | 'pause'
    | 'stop'
    | 'more'
    | 'expand'
    | 'collapse'
    | 'next'
    | 'filter'
    | 'branch'
    | 'file'
    | 'agent'
    | 'link'

  export type WithChildren = { children?: OCCNode }
  export type Leaf = { children?: never }
  /** A fixed-height scroll area, so long content does not push the rest of the panel away. */
  export type MaxHeight = 'sm' | 'md' | 'lg' | 'none'

  /** Unset `align`: fields, tables and cards fill the width, buttons keep their own; `stretch`
   *  stretches buttons too. */
  export type StackProps = WithChildren & { gap?: Gap; align?: Align }
  export type RowProps = WithChildren & {
    gap?: Gap
    align?: Align
    justify?: 'start' | 'center' | 'end' | 'between'
    wrap?: boolean
  }
  export type TextProps = WithChildren & {
    tone?: Tone
    muted?: boolean
    size?: Size
    weight?: 'regular' | 'medium' | 'semibold'
    truncate?: boolean
  }
  export type HeadingProps = WithChildren & { level?: 1 | 2 | 3 }
  export type ButtonProps = WithChildren & {
    variant?: Variant
    tone?: Tone
    size?: Size
    icon?: IconName
    /** Since 1.4.247: shown on hover and focus. */
    tooltip?: string
    disabled?: boolean
    onPress?: Press
  }
  export type IconButtonProps = Leaf & {
    icon: IconName
    /** Accessible name, and the tooltip unless `tooltip` is given. */
    label: string
    /** Since 1.4.247. */
    tooltip?: string
    variant?: Variant
    tone?: Tone
    size?: Size
    disabled?: boolean
    onPress?: Press
  }
  export type BadgeProps = WithChildren & { tone?: Tone }
  export type CardProps = WithChildren & { title?: string; description?: string }
  export type ListProps = WithChildren & { label?: string }
  /** With `onPress` the whole row is the press target, so it cannot contain other controls. */
  export type ListItemProps = WithChildren & {
    title?: string
    description?: string
    icon?: IconName
    current?: boolean
    disabled?: boolean
    onPress?: Press
  }
  /**
   * OCC keeps the text as the person types. `defaultValue` seeds it; a changed `value` replaces
   * it (an echo of what was typed does not). `value` without `onChange` is read-only.
   */
  export type InputProps = Leaf & {
    label: string
    labelHidden?: boolean
    value?: string
    defaultValue?: string
    placeholder?: string
    type?: 'text' | 'search' | 'password'
    maxLength?: number
    invalid?: boolean
    disabled?: boolean
    onChange?: (value: string) => void
    onSubmit?: (value: string) => void
  }
  export type SwitchProps = Leaf & {
    label: string
    checked?: boolean
    defaultChecked?: boolean
    disabled?: boolean
    onChange?: (checked: boolean) => void
  }
  export type SelectProps = Leaf & {
    label: string
    labelHidden?: boolean
    value?: string
    defaultValue?: string
    placeholder?: string
    options: readonly { value: string; label: string; disabled?: boolean }[]
    disabled?: boolean
    onChange?: (value: string) => void
  }
  export type SeparatorProps = Leaf & { orientation?: 'horizontal' | 'vertical' }
  export type ProgressProps = Leaf & { label: string; labelHidden?: boolean; value?: number }
  export type SpinnerProps = Leaf & { label: string; labelHidden?: boolean }
  export type EmptyStateProps = WithChildren & {
    title: string
    description?: string
    icon?: IconName
  }
  export type LinkProps = WithChildren & { href?: string; onPress?: Press }
  export type CodeProps = WithChildren & { block?: boolean }

  // Catalog 2, since OCC 1.4.247: check `ui.has()` when your minimum OCC is older.
  export type TextareaProps = Leaf & {
    label: string
    labelHidden?: boolean
    value?: string
    defaultValue?: string
    placeholder?: string
    /** Visible lines, 2 to 20. */
    rows?: number
    maxLength?: number
    invalid?: boolean
    disabled?: boolean
    onChange?: (value: string) => void
    /** Cmd+Enter (Ctrl+Enter off macOS). */
    onSubmit?: (value: string) => void
  }
  export type CheckboxProps = Leaf & {
    label: string
    description?: string
    checked?: boolean
    defaultChecked?: boolean
    disabled?: boolean
    onChange?: (checked: boolean) => void
  }
  export type RadioOption = {
    value: string
    label: string
    description?: string
    disabled?: boolean
  }
  export type RadioGroupProps = Leaf & {
    label: string
    labelHidden?: boolean
    value?: string
    defaultValue?: string
    options: readonly RadioOption[]
    orientation?: 'vertical' | 'horizontal'
    disabled?: boolean
    onChange?: (value: string) => void
  }
  export type SliderProps = Leaf & {
    label: string
    labelHidden?: boolean
    value?: number
    defaultValue?: number
    /** Defaults 0, 100 and 1. */
    min?: number
    max?: number
    step?: number
    showValue?: boolean
    disabled?: boolean
    onChange?: (value: number) => void
  }
  /** A label, description and error around any controls. */
  export type FieldProps = WithChildren & {
    label: string
    description?: string
    error?: string
    required?: boolean
  }
  export const Stack: OCCComponent<StackProps>
  export const Row: OCCComponent<RowProps>
  export const Text: OCCComponent<TextProps>
  export const Heading: OCCComponent<HeadingProps>
  export const Button: OCCComponent<ButtonProps>
  export const IconButton: OCCComponent<IconButtonProps>
  export const Badge: OCCComponent<BadgeProps>
  export const Card: OCCComponent<CardProps>
  export const List: OCCComponent<ListProps>
  export const ListItem: OCCComponent<ListItemProps>
  export const Input: OCCComponent<InputProps>
  export const Switch: OCCComponent<SwitchProps>
  export const Select: OCCComponent<SelectProps>
  export const Separator: OCCComponent<SeparatorProps>
  export const Progress: OCCComponent<ProgressProps>
  export const Spinner: OCCComponent<SpinnerProps>
  export const EmptyState: OCCComponent<EmptyStateProps>
  export const Link: OCCComponent<LinkProps>
  export const Code: OCCComponent<CodeProps>
  export const Textarea: OCCComponent<TextareaProps>
  export const Checkbox: OCCComponent<CheckboxProps>
  export const RadioGroup: OCCComponent<RadioGroupProps>
  export const Slider: OCCComponent<SliderProps>
  export const Field: OCCComponent<FieldProps>

  export type ComponentName =
    | 'Stack'
    | 'Row'
    | 'Text'
    | 'Heading'
    | 'Button'
    | 'IconButton'
    | 'Badge'
    | 'Card'
    | 'List'
    | 'ListItem'
    | 'Input'
    | 'Switch'
    | 'Select'
    | 'Separator'
    | 'Progress'
    | 'Spinner'
    | 'EmptyState'
    | 'Link'
    | 'Code'
    | 'Textarea'
    | 'Checkbox'
    | 'RadioGroup'
    | 'Slider'
    | 'Field'
    | 'Tabs'
    | 'Tab'
    | 'Collapsible'
    | 'Toolbar'
    | 'Grid'
    | 'Table'
    | 'Tree'
    | 'Markdown'
    | 'CodeView'
    | 'Image'
    | 'KeyValue'
    | 'Callout'
    | 'Skeleton'
    | 'RelativeTime'
    | 'Box'
}
