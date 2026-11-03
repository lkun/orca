# Components Gallery

One build-less TSX panel that uses every component in the components catalog: form controls
(`Textarea`, `Checkbox`, `RadioGroup`, `Slider`, `Field`), layout (`Tabs`, `Collapsible`, `Toolbar`,
`Grid`, `Box`, tooltips), a paged and sortable `Table`, a lazily loaded `Tree`, `Markdown`, `CodeView`, a
plugin `Image`, `KeyValue`, `Callout` and `Skeleton`. It needs OCC 1.4.248 or newer
(`Box` is catalog 4).

```sh
occ plugin dev load .   # also writes .occ/types, the typings tsconfig.json extends
occ plugin test .       # runs src/panel.test.tsx in Node with occ/testing
occ plugin check .      # renders the panel once and reports errors with file:line
```

`src/files.ts` stands in for a data source: the Table asks for the next page with `onLoadMore`
when the person scrolls near the end, and the Tree reads a folder's children on first expand.
