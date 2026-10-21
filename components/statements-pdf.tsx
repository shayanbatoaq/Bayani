import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { reportIndex, type NoteBlock, type ReportModel, type Row } from "@/lib/report-model"

/** Page numbers captured while laying out, used to fill the index on a second pass. */
export type PageMarks = Partial<Record<(typeof reportIndex)[number] | "end", number>>

const ink = "#1b2a36"
const rule = "#8a98a3"
const styles = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 64, paddingHorizontal: 56, fontFamily: "Times-Roman", fontSize: 10, color: ink, lineHeight: 1.35 },
  landscape: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 48, fontFamily: "Times-Roman", fontSize: 9.5, color: ink, lineHeight: 1.3 },
  head: { marginBottom: 18 },
  company: { fontFamily: "Times-Bold", fontSize: 13 },
  title: { fontFamily: "Times-Bold", fontSize: 10.5, marginTop: 3, textTransform: "uppercase" },
  colHead: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: rule, paddingBottom: 3, marginBottom: 4, fontFamily: "Times-Bold" },
  row: { flexDirection: "row", paddingVertical: 2.2 },
  label: { flex: 1, paddingRight: 8 },
  note: { width: 34, textAlign: "center" },
  amount: { width: 92, textAlign: "right" },
  heading: { fontFamily: "Times-Bold", marginTop: 7 },
  subtotal: { fontFamily: "Times-Bold", borderTopWidth: 0.6, borderTopColor: rule, marginBottom: 3 },
  total: { fontFamily: "Times-Bold", borderTopWidth: 0.6, borderTopColor: ink, borderBottomWidth: 1.8, borderBottomColor: ink, marginTop: 2, marginBottom: 6 },
  footer: { position: "absolute", bottom: 26, left: 56, right: 56, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#5c6d78" },
  integral: { marginTop: 18, fontSize: 9, fontFamily: "Times-Italic" },
  sign: { marginTop: 36, width: 200 },
  signLine: { borderTopWidth: 0.6, borderTopColor: ink, marginTop: 34, paddingTop: 3 },
  noteTitle: { fontFamily: "Times-Bold", marginTop: 12, marginBottom: 4 },
  para: { marginBottom: 5, textAlign: "justify" },
})

const fmt = (value: number | null | undefined) => {
  if (value === null || value === undefined) return ""
  const rounded = Math.round(value * 100) / 100
  if (rounded === 0) return "-"
  const text = Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return rounded < 0 ? `(${text})` : text
}

type OnPage = (name: keyof PageMarks, page: number) => void

function Mark({ onPage, name }: { onPage?: OnPage; name: keyof PageMarks }) {
  return (
    <Text
      render={({ pageNumber }) => {
        onPage?.(name, pageNumber - 2)
        return ""
      }}
    />
  )
}

function Footer({ model }: { model: ReportModel }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{model.companyName}</Text>
      <Text render={({ pageNumber }) => `${pageNumber - 2}`} />
    </View>
  )
}

function Header({ model, title }: { model: ReportModel; title: string }) {
  return (
    <View style={styles.head} fixed>
      <Text style={styles.company}>{model.companyName}</Text>
      <Text style={styles.title}>{title}</Text>
    </View>
  )
}

function Columns({ model, withNote = true }: { model: ReportModel; withNote?: boolean }) {
  return (
    <View style={styles.colHead} fixed>
      <Text style={styles.label} />
      {withNote && <Text style={styles.note}>Note</Text>}
      <Text style={styles.amount}>
        {model.year}
        {"\n"}
        {model.currency}
      </Text>
      {model.priorYear && (
        <Text style={styles.amount}>
          {model.priorYear}
          {"\n"}
          {model.currency}
        </Text>
      )}
    </View>
  )
}

function Rows({ rows, model, withNote = true }: { rows: Row[]; model: ReportModel; withNote?: boolean }) {
  return (
    <>
      {rows.map((row, i) => {
        const style = [styles.row, row.kind === "heading" ? styles.heading : row.kind === "subtotal" ? styles.subtotal : row.kind === "total" ? styles.total : {}]
        return (
          <View key={i} style={style} wrap={false}>
            <Text style={styles.label}>{row.label}</Text>
            {withNote && <Text style={styles.note}>{row.note ?? ""}</Text>}
            <Text style={styles.amount}>{row.kind === "heading" ? "" : fmt(row.current)}</Text>
            {model.priorYear && <Text style={styles.amount}>{row.kind === "heading" ? "" : fmt(row.prior)}</Text>}
          </View>
        )
      })}
    </>
  )
}

function Signature({ model }: { model: ReportModel }) {
  return (
    <View wrap={false}>
      <Text style={styles.integral}>The accompanying notes form an integral part of these financial statements.</Text>
      <View style={styles.sign}>
        <Text>For {model.companyName}</Text>
        <Text style={styles.signLine}>Authorised signatory</Text>
      </View>
    </View>
  )
}

function Note({ note, model }: { note: NoteBlock; model: ReportModel }) {
  const size = (note.rows?.length ?? 0) + (note.table?.body.length ?? 0) + (note.paragraphs?.join(" ").length ?? 0) / 90
  return (
    <View wrap={size > 28} minPresenceAhead={60}>
      <View wrap={false}>
        <Text style={styles.noteTitle}>
          {note.number}. {note.title.toUpperCase()}
        </Text>
        {note.rows && (
          <View style={[styles.row, { fontFamily: "Times-Bold", paddingBottom: 3 }]}>
            <Text style={styles.label} />
            <Text style={styles.amount}>
              {model.year} {model.currency}
            </Text>
            {model.priorYear && (
              <Text style={styles.amount}>
                {model.priorYear} {model.currency}
              </Text>
            )}
          </View>
        )}
      </View>
      {note.paragraphs?.map((text, i) => (
        <Text key={i} style={styles.para}>
          {text}
        </Text>
      ))}
      {note.rows && <Rows rows={note.rows} model={model} withNote={false} />}
      {note.table && (
        <View style={{ marginTop: 4, marginBottom: 4 }} wrap={false}>
          {[note.table.head, ...note.table.body].map((cells, r) => (
            <View
              key={r}
              style={[
                styles.row,
                r === 0 ? { fontFamily: "Times-Bold", borderBottomWidth: 0.6, borderBottomColor: rule } : {},
                r === note.table!.body.length ? { fontFamily: "Times-Bold", borderTopWidth: 0.6, borderTopColor: rule } : {},
              ]}
            >
              {cells.map((cell, c) => (
                <Text key={c} style={c === 0 ? styles.label : c === 1 ? { width: 110 } : styles.amount}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

export function StatementsPdf({ model, pages, onPage }: { model: ReportModel; pages?: PageMarks; onPage?: OnPage }) {
  const range = (name: (typeof reportIndex)[number], next?: (typeof reportIndex)[number] | "end") => {
    const start = pages?.[name]
    const end = next ? (pages?.[next] ?? 0) - (next === "end" ? 0 : 1) : start
    if (!start) return ""
    return end && end > start ? `${start} - ${end}` : `${start}`
  }
  const titleYear = `FOR THE YEAR ENDED ${model.periodEndText.toUpperCase()}`
  return (
    <Document title={`${model.companyName} – Financial statements ${model.year}`} author={model.companyName} creator="FinScope">
      {/* Cover */}
      <Page size="A4" style={[styles.page, { justifyContent: "center", alignItems: "center", textAlign: "center" }]}>
        <View style={{ borderTopWidth: 1.4, borderBottomWidth: 1.4, borderColor: ink, paddingVertical: 28, paddingHorizontal: 20, width: "100%" }}>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 24, letterSpacing: 1, lineHeight: 1.2 }}>{model.companyName.toUpperCase()}</Text>
          <Text style={{ fontSize: 12, marginTop: 14, letterSpacing: 1.5, lineHeight: 1.2 }}>{model.location}</Text>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 15, marginTop: 44, letterSpacing: 2 }}>FINANCIAL STATEMENTS</Text>
          <Text style={{ fontSize: 12, marginTop: 8 }}>{titleYear}</Text>
        </View>
        <Text style={{ position: "absolute", bottom: 60, fontFamily: "Times-Italic", fontSize: 10 }}>Private &amp; Confidential</Text>
      </Page>

      {/* Index */}
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <Text style={styles.company}>{model.companyName}</Text>
          <Text style={styles.title}>Index to the financial statements</Text>
        </View>
        <View style={styles.colHead}>
          <Text style={styles.label}>Particulars</Text>
          <Text style={styles.amount}>Page</Text>
        </View>
        {reportIndex.map((name, i) => (
          <View key={name} style={[styles.row, { paddingVertical: 5 }]}>
            <Text style={styles.label}>{name}</Text>
            <Text style={styles.amount}>
              {name === "Significant accounting policies"
                ? range(name, "Notes to the financial statements")
                : name === "Notes to the financial statements"
                  ? range(name, "end")
                  : range(name, reportIndex[i + 1])}
            </Text>
          </View>
        ))}
      </Page>

      {/* Company information */}
      <Page size="A4" style={styles.page}>
        <Mark onPage={onPage} name="Company information" />
        <Header model={model} title="Company information" />
        {model.companyInfo.map((item) => (
          <View key={item.heading} style={{ marginBottom: 12 }} wrap={false}>
            <Text style={{ fontFamily: "Times-Bold", textTransform: "uppercase", fontSize: 9.5 }}>{item.heading}</Text>
            {item.text.map((line, i) => (
              <Text key={i} style={{ marginTop: 2 }}>
                {line}
              </Text>
            ))}
          </View>
        ))}
        <Footer model={model} />
      </Page>

      {/* Statement of financial position */}
      <Page size="A4" style={styles.page}>
        <Mark onPage={onPage} name="Statement of financial position" />
        <Header model={model} title={`Statement of financial position as at ${model.periodEndText}`} />
        <Columns model={model} />
        <Rows rows={model.bs} model={model} />
        <Signature model={model} />
        <Footer model={model} />
      </Page>

      {/* Statement of comprehensive income */}
      <Page size="A4" style={styles.page}>
        <Mark onPage={onPage} name="Statement of comprehensive income" />
        <Header model={model} title={`Statement of comprehensive income ${model.yearEndedText}`} />
        <Columns model={model} />
        <Rows rows={model.income} model={model} />
        <Signature model={model} />
        <Footer model={model} />
      </Page>

      {/* Statement of changes in equity */}
      <Page size="A4" orientation="landscape" style={styles.landscape}>
        <Mark onPage={onPage} name="Statement of changes in equity" />
        <Header model={model} title={`Statement of changes in equity ${model.yearEndedText}`} />
        {model.equity.map((table) => (
          <View key={table.year} style={{ marginBottom: 14 }} wrap={false}>
            <View style={styles.colHead}>
              <Text style={styles.label}>{table.year}</Text>
              {table.columns.map((column) => (
                <Text key={column} style={[styles.amount, { width: 100 }]}>
                  {column}
                  {"\n"}
                  {model.currency}
                </Text>
              ))}
            </View>
            {table.lines.map((line, i) => (
              <View key={i} style={[styles.row, line.total ? styles.total : {}]}>
                <Text style={styles.label}>{line.label}</Text>
                {line.values.map((value, j) => (
                  <Text key={j} style={[styles.amount, { width: 100 }]}>
                    {value === null ? "n.a." : fmt(value)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))}
        <Signature model={model} />
        <View style={[styles.footer, { left: 48, right: 48 }]} fixed>
          <Text>{model.companyName}</Text>
          <Text render={({ pageNumber }) => `${pageNumber - 2}`} />
        </View>
      </Page>

      {/* Statement of cash flows */}
      <Page size="A4" style={styles.page}>
        <Mark onPage={onPage} name="Statement of cash flows" />
        <Header model={model} title={`Statement of cash flows ${model.yearEndedText}`} />
        <Columns model={model} />
        <Rows rows={model.cashFlow} model={model} />
        <Signature model={model} />
        <Footer model={model} />
      </Page>

      {/* Policies */}
      <Page size="A4" style={styles.page}>
        <Mark onPage={onPage} name="Significant accounting policies" />
        <Header model={model} title={`Significant accounting policies ${model.yearEndedText}`} />
        {model.policies.map((note) => (
          <Note key={note.number} note={note} model={model} />
        ))}
        <Footer model={model} />
      </Page>

      {/* Notes */}
      <Page size="A4" style={styles.page}>
        <Mark onPage={onPage} name="Notes to the financial statements" />
        <Header model={model} title={`Notes to the financial statements ${model.yearEndedText}`} />
        {model.notes.map((note) => (
          <Note key={note.number} note={note} model={model} />
        ))}
        <Mark onPage={onPage} name="end" />
        <Footer model={model} />
      </Page>
    </Document>
  )
}
