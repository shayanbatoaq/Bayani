import "@/lib/pdf-fonts"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { Style } from "@react-pdf/stylesheet"
import { reportIndex, type EquityTable, type IndexKey, type ReportModel, type Row, type Schedule } from "@/lib/report-model"

/** Page numbers captured while laying out, used to fill the index on a second pass. */
export type PageMarks = Partial<Record<IndexKey | "end", number>>
type OnPage = (name: keyof PageMarks, page: number) => void

const black = "#000000"
const NOTE_W = 40
const AMOUNT_W = 84
const GAP = 7

const s = StyleSheet.create({
  page: { paddingTop: 60, paddingBottom: 58, paddingHorizontal: 58, fontFamily: "Serif", fontSize: 9.5, color: black, lineHeight: 1.18 },
  bold: { fontWeight: "bold" },
  company: { fontWeight: "bold", fontSize: 10.5 },
  title: { fontWeight: "bold", fontSize: 10.5, marginTop: 2 },
  pageNumber: { position: "absolute", bottom: 30, left: 0, right: 0, textAlign: "center", fontFamily: "Sans", fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center" },
  label: { flex: 1, paddingRight: 6, paddingVertical: 1.45 },
  note: { width: NOTE_W, textAlign: "center", paddingVertical: 1.45 },
  amountCell: { width: AMOUNT_W, marginLeft: GAP },
  amountText: { textAlign: "right", paddingVertical: 1.45, paddingRight: 3 },
  yearBox: { width: AMOUNT_W, marginLeft: GAP, backgroundColor: black, paddingVertical: 6 },
  yearText: { color: "#ffffff", fontWeight: "bold", textAlign: "center", fontSize: 9 },
  integral: { marginTop: 10, fontSize: 9 },
  signature: { marginTop: 10 },
})

/** Whole currency units, negatives in brackets, nil as a dash. */
const fmt = (value: number | null | undefined) => {
  if (value === null || value === undefined) return ""
  const rounded = Math.round(value)
  if (rounded === 0) return "-"
  const text = Math.abs(rounded).toLocaleString("en-US")
  return rounded < 0 ? `(${text})` : text
}

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

/** Cover and index are unnumbered; the statements start at page 1. */
function PageNumber() {
  return <Text style={s.pageNumber} fixed render={({ pageNumber }) => (pageNumber > 2 ? `${pageNumber - 2}` : "")} />
}

function Heading({ model, title }: { model: ReportModel; title: string }) {
  return (
    <View style={{ marginBottom: 10, flexDirection: "row", alignItems: "flex-end" }}>
      <View style={{ flex: 1 }}>
        <Text style={s.company}>{model.companyName}</Text>
        <Text style={s.title}>{title}</Text>
      </View>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {model.logo ? <Image src={model.logo} style={{ maxHeight: 22, maxWidth: 100, objectFit: "contain", marginLeft: 12 }} /> : null}
    </View>
  )
}

/** Note column, black year boxes and the currency line beneath, as in the reference layout. */
function YearHeader({ model, withNote = true }: { model: ReportModel; withNote?: boolean }) {
  const years = [model.year, ...(model.priorYear ? [model.priorYear] : [])]
  return (
    <View style={{ marginBottom: 4 }} fixed>
      <View style={[s.row, { alignItems: "flex-end" }]}>
        <View style={{ flex: 1, borderBottomWidth: 2.4, borderBottomColor: black }} />
        <View style={{ width: NOTE_W, borderBottomWidth: 2.4, borderBottomColor: black, paddingBottom: 2 }}>
          {withNote && <Text style={[s.bold, { textAlign: "center" }]}>Note</Text>}
        </View>
        {years.map((year) => (
          <View key={year} style={s.yearBox}>
            <Text style={s.yearText}>{year}</Text>
          </View>
        ))}
      </View>
      <View style={[s.row, { marginTop: 3 }]}>
        <View style={{ flex: 1 }} />
        <View style={{ width: NOTE_W }} />
        {years.map((year) => (
          <Text key={year} style={[s.bold, { width: AMOUNT_W, marginLeft: GAP, textAlign: "center" }]}>
            {model.currency}
          </Text>
        ))}
      </View>
    </View>
  )
}

function Amount({ value, kind }: { value: number | null; kind?: Row["kind"] }) {
  if (kind === "subtotal")
    return (
      <View style={[s.amountCell, { borderTopWidth: 0.8, borderTopStyle: "dashed", borderBottomWidth: 0.8, borderBottomStyle: "dashed", marginTop: 2, marginBottom: 3 }]}>
        <Text style={[s.amountText, s.bold]}>{fmt(value)}</Text>
      </View>
    )
  if (kind === "total")
    return (
      <View style={[s.amountCell, { borderTopWidth: 0.9, borderBottomWidth: 0.9, paddingBottom: 1.6, marginTop: 2, marginBottom: 3 }]}>
        <View style={{ borderBottomWidth: 0.9 }}>
          <Text style={[s.amountText, s.bold]}>{fmt(value)}</Text>
        </View>
      </View>
    )
  return (
    <View style={s.amountCell}>
      <Text style={s.amountText}>{kind === "heading" && value === null ? "" : fmt(value)}</Text>
    </View>
  )
}

function StatementRow({ row, model, indent = 0, withNote = true }: { row: Row; model: ReportModel; indent?: number; withNote?: boolean }) {
  if (row.kind === "spacer") return <View style={{ height: 4 }} />
  const strong = Boolean(row.kind)
  const labelStyle: Style[] = [s.label, { marginLeft: indent }]
  if (strong) labelStyle.push(s.bold)
  if (row.kind === "section") labelStyle.push({ paddingTop: 6 })
  if (row.kind === "heading") labelStyle.push({ paddingTop: 5 })
  if (row.kind === "total") labelStyle.push({ borderTopWidth: 1.4, borderBottomWidth: 1.4, marginTop: 2, marginBottom: 3 })
  const showAmounts = row.kind !== "section" && !(row.kind === "heading" && row.current === null)
  return (
    <View style={s.row} wrap={false}>
      <Text style={labelStyle}>{row.label}</Text>
      <Text style={[s.note, strong ? s.bold : {}]}>{withNote && row.note ? String(row.note) : ""}</Text>
      {showAmounts ? (
        <>
          <Amount value={row.current} kind={row.kind} />
          {model.priorYear && <Amount value={row.prior} kind={row.kind} />}
        </>
      ) : (
        <>
          <View style={s.amountCell} />
          {model.priorYear && <View style={s.amountCell} />}
        </>
      )}
    </View>
  )
}

function Signature({ model, schedules = false }: { model: ReportModel; schedules?: boolean }) {
  return (
    <View wrap={false}>
      <Text style={s.integral}>
        {schedules
          ? "The schedules above form an integral part of these financial statements."
          : "The annexed schedules form an integral part of these financial statements."}
      </Text>
      <View style={s.signature}>
        <Text style={s.bold}>For {model.companyName}</Text>
        <Text style={s.bold}>{model.place}</Text>
        <View style={{ width: 92, borderBottomWidth: 0.8, marginTop: 34 }} />
        <Text style={[s.bold, { marginTop: 4 }]}>Authorised Signatory</Text>
      </View>
    </View>
  )
}

function Cover({ model }: { model: ReportModel }) {
  return (
    <Page size="A4" style={[s.page, { fontSize: 12 }]}>
      <View style={{ marginTop: model.logo ? 90 : 150, alignItems: "center" }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {model.logo ? <Image src={model.logo} style={{ maxHeight: 90, maxWidth: 220, objectFit: "contain", marginBottom: 40 }} /> : null}
        <View style={{ width: 70, borderTopWidth: 1.2, marginBottom: 18 }} />
        <Text style={[s.bold, { fontSize: 13, textAlign: "center" }]}>{model.companyName}</Text>
        <Text style={[s.bold, { marginTop: 4, textAlign: "center" }]}>{model.location}</Text>
        <Text style={[s.bold, { marginTop: 4, textAlign: "center" }]}>FINANCIAL STATEMENTS</Text>
        <Text style={[s.bold, { marginTop: 4, textAlign: "center" }]}>{model.periodEndText}</Text>
        <View style={{ width: 70, borderTopWidth: 1.2, marginTop: 18 }} />
      </View>
      <Text style={[s.bold, { position: "absolute", bottom: 70, left: 0, right: 0, textAlign: "center" }]}>Private &amp; Confidential</Text>
    </Page>
  )
}

function IndexPage({ model, pages }: { model: ReportModel; pages?: PageMarks }) {
  const range = (key: IndexKey, i: number) => {
    const start = pages?.[key]
    if (!start) return ""
    const nextKey = reportIndex[i + 1]?.key
    const end = (nextKey ? pages?.[nextKey] : pages?.end) ?? start
    const last = nextKey ? end - 1 : end
    return last > start ? `${start} - ${last}` : String(start)
  }
  return (
    <Page size="A4" style={[s.page, { fontSize: 10.5 }]}>
      <View style={{ marginTop: 40 }}>
        <Text style={[s.bold, { fontSize: 11, paddingBottom: 3, borderBottomWidth: 2 }]}>{model.companyName}</Text>
        <Text style={[s.bold, { fontSize: 11, textAlign: "center", marginTop: 14, marginBottom: 14 }]}>INDEX TO THE FINANCIAL STATEMENTS</Text>
        <View style={[s.row, { borderTopWidth: 1.2, borderBottomWidth: 2, paddingVertical: 8, marginTop: 6 }]}>
          <Text style={[s.bold, { flex: 1, textAlign: "center" }]}>PARTICULARS</Text>
          <Text style={[s.bold, { width: 150, textAlign: "center" }]}>PAGE NUMBER</Text>
        </View>
        <View style={{ borderBottomWidth: 2, paddingBottom: 4 }}>
          {reportIndex.map((item, i) => (
            <View key={item.key} style={[s.row, { paddingTop: 13 }]}>
              <Text style={{ flex: 1 }}>{item.label}</Text>
              <Text style={{ width: 150, textAlign: "center" }}>{range(item.key, i)}</Text>
            </View>
          ))}
        </View>
      </View>
    </Page>
  )
}

function DetailsPage({ model, onPage }: { model: ReportModel; onPage?: OnPage }) {
  return (
    <Page size="A4" style={s.page}>
      <Mark onPage={onPage} name="details" />
      <Heading model={model} title="COMPANY DETAILS" />
      <View style={{ borderTopWidth: 2.4, marginTop: 6 }}>
        {model.details.map((item) => (
          <View key={item.label} style={[s.row, { alignItems: "flex-start", borderBottomWidth: 0.6, borderBottomColor: "#9a9a9a", paddingVertical: 7 }]} wrap={false}>
            <Text style={[s.bold, { width: 170 }]}>{item.label}</Text>
            <View style={{ flex: 1 }}>
              {item.lines.map((line, i) => (
                <Text key={i} style={{ marginBottom: i < item.lines.length - 1 ? 2 : 0 }}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
        ))}
      </View>
      <PageNumber />
    </Page>
  )
}

function StatementPage({
  model,
  title,
  rows,
  mark,
  onPage,
}: {
  model: ReportModel
  title: string
  rows: Row[]
  mark: IndexKey
  onPage?: OnPage
}) {
  return (
    <Page size="A4" style={s.page}>
      <Mark onPage={onPage} name={mark} />
      <Heading model={model} title={title} />
      <YearHeader model={model} />
      {rows.map((row, i) => (
        <StatementRow key={i} row={row} model={model} />
      ))}
      <Signature model={model} />
      <PageNumber />
    </Page>
  )
}

function EquityBlock({ table, model }: { table: EquityTable; model: ReportModel }) {
  const W = 66
  return (
    <View style={{ marginBottom: 20 }} wrap={false}>
      <View style={[s.row, { alignItems: "flex-end" }]}>
        <View style={{ flex: 1 }} />
        {table.columns.map((column) => (
          <Text key={column} style={[s.bold, { width: W, marginLeft: 5, textAlign: "center" }]}>
            {column}
          </Text>
        ))}
      </View>
      <View style={[s.row, { borderBottomWidth: 1.2, paddingBottom: 4, marginTop: 6 }]}>
        <Text style={[s.bold, { flex: 1 }]}>{table.year}</Text>
        {table.columns.map((column) => (
          <Text key={column} style={[s.bold, { width: W, marginLeft: 5, textAlign: "center" }]}>
            {model.currency}
          </Text>
        ))}
      </View>
      {table.lines.map((line, i) => (
        <View key={i} style={[s.row, { marginTop: line.kind ? 6 : 9 }]}>
          <Text style={[{ flex: 1, paddingVertical: 1.7 }, line.kind ? [s.bold, { borderTopWidth: 1.4, borderBottomWidth: 1.4 }] : {}].flat()}>{line.label}</Text>
          {line.values.map((value, j) => (
            <View key={j} style={[{ width: W, marginLeft: 5 }, line.kind ? { borderTopWidth: 1.4, borderBottomWidth: 1.4 } : {}]}>
              <Text style={[{ textAlign: "right", paddingVertical: 1.7, paddingRight: 2 }, line.kind ? s.bold : {}]}>{fmt(value)}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

function ScheduleBlock({ schedule, model }: { schedule: Schedule; model: ReportModel }) {
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <View style={s.row}>
        <Text style={[s.bold, { width: 26 }]}>{schedule.number}</Text>
        <Text style={[s.bold, { flex: 1 }]}>{schedule.title}</Text>
      </View>
      {schedule.paragraphs?.map((text, i) => (
        <Text key={i} style={{ marginLeft: 26, marginTop: 3, marginBottom: 4, textAlign: "justify" }}>
          {text}
        </Text>
      ))}
      {schedule.table && (
        <View style={{ marginLeft: 26, marginTop: 2 }}>
          <View style={[s.row, { borderBottomWidth: 0.9, paddingBottom: 2 }]}>
            {schedule.table.head.map((cell, i) => (
              <Text key={i} style={[s.bold, cellStyle(i, schedule.table!.numeric)]}>
                {cell}
              </Text>
            ))}
          </View>
          {schedule.table.body.map((cells, r) => {
            const total = schedule.table!.totalLast && r === schedule.table!.body.length - 1
            return (
              <View key={r} style={[s.row, total ? { borderTopWidth: 0.9, borderBottomWidth: 0.9, marginTop: 2 } : {}]}>
                {cells.map((cell, i) => (
                  <Text key={i} style={[cellStyle(i, schedule.table!.numeric), { paddingVertical: 1.7 }, total ? s.bold : {}]}>
                    {cell}
                  </Text>
                ))}
              </View>
            )
          })}
        </View>
      )}
      {schedule.rows?.map((row, i) => (
        <StatementRow key={i} row={row} model={model} indent={26} withNote={false} />
      ))}
    </View>
  )
}

function cellStyle(index: number, numeric: number[]): Style {
  if (numeric.includes(index)) return { width: index === numeric.at(-1) ? AMOUNT_W : 60, textAlign: "right", paddingRight: 3 }
  return index === 0 ? { flex: 1 } : { width: 110 }
}

export function StatementsPdf({ model, pages, onPage }: { model: ReportModel; pages?: PageMarks; onPage?: OnPage }) {
  const ended = `FOR THE YEAR ENDED ${model.periodEndText.toUpperCase()}`
  return (
    <Document title={`${model.companyName} - Financial Statements ${model.year}`} author={model.companyName} creator="FinScope" producer="FinScope">
      <Cover model={model} />
      <IndexPage model={model} pages={pages} />
      <DetailsPage model={model} onPage={onPage} />
      <StatementPage
        model={model}
        mark="bs"
        onPage={onPage}
        title={`STATEMENT OF FINANCIAL POSITION AS AT ${model.periodEndText.toUpperCase()}`}
        rows={model.bs}
      />
      <StatementPage model={model} mark="income" onPage={onPage} title={`STATEMENT OF COMPREHENSIVE INCOME ${ended}`} rows={model.income} />
      <Page size="A4" style={s.page}>
        <Mark onPage={onPage} name="equity" />
        <Heading model={model} title={`STATEMENT OF CHANGES IN EQUITY ${ended}`} />
        <View style={{ marginTop: 10 }}>
          {model.equity.map((table) => (
            <EquityBlock key={table.year} table={table} model={model} />
          ))}
        </View>
        <Signature model={model} />
        <PageNumber />
      </Page>
      <StatementPage model={model} mark="cashFlow" onPage={onPage} title={`STATEMENT OF CASH FLOWS ${ended}`} rows={model.cashFlow} />
      <Page size="A4" style={s.page}>
        <Mark onPage={onPage} name="schedules" />
        <View fixed>
          <Heading model={model} title={`SCHEDULES TO THE FINANCIAL STATEMENTS ${ended}`} />
        </View>
        <YearHeader model={model} withNote={false} />
        {model.schedules.map((schedule) => (
          <ScheduleBlock key={schedule.number} schedule={schedule} model={model} />
        ))}
        <Signature model={model} schedules />
        <Mark onPage={onPage} name="end" />
        <PageNumber />
      </Page>
    </Document>
  )
}
