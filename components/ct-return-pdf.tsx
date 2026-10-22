import "@/lib/pdf-fonts"
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { Company } from "@/lib/company"
import type { CtReturn, FormRow } from "@/lib/ct-return"

/**
 * Corporate tax return worksheet laid out like the return extract: one table per
 * EmaraTax step, the 26-line tax summary, then the computation commentary.
 * Prepared for keying into EmaraTax; it is not a document issued by the FTA.
 */
const band = "#ece5b5"
const grey = "#d4d4d4"
const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 54, paddingHorizontal: 34, fontFamily: "Sans", fontSize: 8.6, color: "#111", lineHeight: 1.25 },
  title: { borderWidth: 0.8, backgroundColor: "#c9c9c9", textAlign: "center", fontWeight: "bold", fontSize: 10, paddingVertical: 4, marginBottom: 12 },
  table: { borderWidth: 0.8, marginBottom: 12 },
  band: { backgroundColor: band, textAlign: "center", fontWeight: "bold", paddingVertical: 4, borderBottomWidth: 0.8 },
  sub: { fontWeight: "bold", paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.6 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, minHeight: 15 },
  label: { flex: 1, paddingVertical: 3, paddingHorizontal: 4, borderRightWidth: 0.6 },
  cell: { width: 110, paddingVertical: 3, paddingHorizontal: 4, textAlign: "right" },
  footer: { position: "absolute", bottom: 20, left: 34, right: 34, textAlign: "center", fontSize: 7, color: "#777" },
  para: { marginBottom: 5, textAlign: "justify", fontSize: 9 },
})

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : (Math.round(n) || 0).toLocaleString("en-US"))
const show = (value: FormRow["value"]) =>
  typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "number" ? fmt(value) : value === null || value === undefined || value === "" ? "-" : String(value)
const dmy = (iso: string) => iso.split("-").reverse().join("/")

function Footer({ company }: { company: Company }) {
  return (
    <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${company.name} · Corporate tax return worksheet prepared with FinScope for entry in EmaraTax — not a document issued by the Federal Tax Authority · Page ${pageNumber} of ${totalPages}`} />
  )
}

function Pair({ cells }: { cells: [string, string][] }) {
  return (
    <View style={s.row} wrap={false}>
      {cells.map(([label, value], i) => (
        <View key={i} style={{ flexDirection: "row", flex: 1, borderRightWidth: i < cells.length - 1 ? 0.6 : 0 }}>
          <Text style={[s.label, { flex: 1 }]}>{label}</Text>
          <Text style={[s.cell, { width: 100 }]}>{value}</Text>
        </View>
      ))}
    </View>
  )
}

export function CtReturnPdf({ company, ret }: { company: Company; ret: CtReturn }) {
  const answersRows = (rows: FormRow[]) => rows.filter((row) => !row.hidden)
  return (
    <Document title={`${company.name} - Corporate Tax Return ${ret.year}`} author="FinScope" creator="FinScope">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Corporate Tax Return</Text>
        <View style={s.table}>
          <Text style={s.band}>Corporate Tax Return Information</Text>
          <Pair cells={[["Corporate Tax Period Description", `Tax Year End ${ret.periodEnd.slice(5, 7) === "12" ? "Dec" : ret.periodEnd.slice(5, 7)}-${ret.periodEnd.slice(0, 4)}`], ["Corporate Tax Return Due Date", dmy(ret.dueDate)]]} />
          <Pair cells={[["Period From", dmy(ret.periodStart)], ["Regime", ret.regime]]} />
          <Pair cells={[["Period To", dmy(ret.periodEnd)], ["Net Corporate Tax Position (AED)", fmt(ret.payable)]]} />
          <Pair cells={[["Review status", ret.status], ["Prepared on", dmy(new Date().toISOString().slice(0, 10))]]} />
        </View>

        {ret.steps.map((step) => (
          <View key={step.number} style={s.table}>
            <Text style={s.band}>
              {step.number}. {step.title}
            </Text>
            {step.sections.map((section) => (
              <View key={section.title}>
                <View style={[s.row, { backgroundColor: "#f3f3f3" }]} wrap={false}>
                  <Text style={[s.label, { fontWeight: "bold" }]}>{section.title}</Text>
                  {section.columns === "comparative" ? (
                    <>
                      <Text style={[s.cell, { fontWeight: "bold", borderRightWidth: 0.6 }]}>Current Period (AED)</Text>
                      <Text style={[s.cell, { fontWeight: "bold" }]}>Previous Period (AED)</Text>
                    </>
                  ) : (
                    <Text style={[s.cell, { fontWeight: "bold" }]}>{section.columns === "amount" ? "Total Amount (AED)" : ""}</Text>
                  )}
                </View>
                {answersRows(section.rows).map((row, i) =>
                  row.kind === "heading" ? (
                    <Text key={i} style={[s.sub, { backgroundColor: grey }]}>
                      {row.label}
                    </Text>
                  ) : (
                    <View key={i} style={[s.row, row.kind === "total" ? { backgroundColor: grey } : {}]} wrap={false}>
                      <Text style={[s.label, row.kind === "total" ? { fontWeight: "bold" } : {}]}>{row.label}</Text>
                      {section.columns === "comparative" ? (
                        <>
                          <Text style={[s.cell, { borderRightWidth: 0.6 }, row.kind === "total" ? { fontWeight: "bold" } : {}]}>{show(row.value)}</Text>
                          <Text style={[s.cell, row.kind === "total" ? { fontWeight: "bold" } : {}]}>{row.prior === null || row.prior === undefined ? "-" : fmt(row.prior)}</Text>
                        </>
                      ) : (
                        <Text style={[s.cell, { width: typeof row.value === "string" && row.value.length > 24 ? 220 : 110 }, row.kind === "total" ? { fontWeight: "bold" } : {}]}>{show(row.value)}</Text>
                      )}
                    </View>
                  )
                )}
              </View>
            ))}
          </View>
        ))}

        <View style={s.table} break>
          <Text style={s.band}>Tax Summary</Text>
          <View style={[s.row, { backgroundColor: "#f3f3f3" }]}>
            <Text style={{ width: 28, paddingVertical: 3, textAlign: "center", fontWeight: "bold", borderRightWidth: 0.6 }}>S.no</Text>
            <Text style={[s.label, { fontWeight: "bold" }]}>Description</Text>
            <Text style={[s.cell, { fontWeight: "bold" }]}>Total Amount (AED)</Text>
          </View>
          {ret.summary.map((line, i) => (
            <View key={line.no} wrap={false}>
              {(i === 0 || ret.summary[i - 1].group !== line.group) && <Text style={s.sub}>{line.group}</Text>}
              <View style={s.row}>
                <Text style={{ width: 28, paddingVertical: 3, textAlign: "center", borderRightWidth: 0.6 }}>{line.no}</Text>
                <Text style={[s.label, line.no >= 23 ? { fontWeight: "bold" } : {}]}>{line.label}</Text>
                <Text style={[s.cell, line.no >= 23 ? { fontWeight: "bold" } : {}]}>{fmt(line.amount)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View break>
          <Text style={s.title}>Computation commentary</Text>
          {ret.commentary.map((block) => (
            <View key={block.title} style={{ marginBottom: 8 }}>
              <Text style={{ fontWeight: "bold", fontSize: 10, marginBottom: 3 }}>{block.title}</Text>
              {block.paragraphs.map((text, i) => (
                <Text key={i} style={s.para}>
                  {text}
                </Text>
              ))}
            </View>
          ))}
          {(ret.blockers.length > 0 || ret.warnings.length > 0 || ret.assumptions.length > 0) && (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontWeight: "bold", fontSize: 10, marginBottom: 3 }}>Open points before filing</Text>
              {[...ret.blockers, ...ret.warnings, ...ret.assumptions].map((text, i) => (
                <Text key={i} style={s.para}>
                  • {text}
                </Text>
              ))}
            </View>
          )}
          <View style={s.table}>
            <Text style={s.band}>Disclosures, schedules and records</Text>
            {ret.disclosures.map((item) => (
              <View key={item.item} style={s.row} wrap={false}>
                <Text style={{ width: 150, padding: 3, fontWeight: "bold", borderRightWidth: 0.6 }}>{item.item}</Text>
                <Text style={{ width: 62, padding: 3, borderRightWidth: 0.6 }}>{item.status}</Text>
                <Text style={{ flex: 1, padding: 3 }}>{item.reason}</Text>
              </View>
            ))}
          </View>
        </View>
        <Footer company={company} />
      </Page>
    </Document>
  )
}
