import "@/lib/pdf-fonts"
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { Company } from "@/lib/company"
import type { RegistrationCheck, VatAnswers, VatReturn } from "@/lib/vat-return"

/** VAT 201 worksheet in the return's layout, followed by the working. Not an FTA document. */
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 50, paddingHorizontal: 32, fontFamily: "Sans", fontSize: 8.6, color: "#111", lineHeight: 1.25 },
  title: { fontSize: 13, fontWeight: "bold", textAlign: "center", marginBottom: 10 },
  band: { backgroundColor: "#ece5b5", fontWeight: "bold", paddingVertical: 4, paddingHorizontal: 5, borderWidth: 0.8, marginTop: 10 },
  row: { flexDirection: "row", borderLeftWidth: 0.8, borderRightWidth: 0.8, borderBottomWidth: 0.6, minHeight: 15, alignItems: "center" },
  num: { width: 80, textAlign: "right", paddingHorizontal: 4, paddingVertical: 3 },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, textAlign: "center", fontSize: 7, color: "#777" },
  para: { marginBottom: 4, fontSize: 8.8, textAlign: "justify" },
})
const aed = (n: number) => (Math.round(n * 100) / 100 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (iso: string) => iso.split("-").reverse().join("/")

export function VatReturnPdf({ company, ret, answers, registration }: { company: Company; ret: VatReturn; answers: VatAnswers; registration: RegistrationCheck }) {
  const info: [string, string, string, string][] = [
    ["TRN", company.vat.trn, "VAT Return Period", `${dmy(ret.period.start)} - ${dmy(ret.period.end)}`],
    ["Legal Name of Entity (English)", company.name, "VAT Stagger", ret.stagger],
    ["Emirate", company.emirate, "VAT Return Due Date", dmy(ret.period.dueDate)],
    ["Licensing authority", company.authority, "Tax Year End", dmy(ret.taxYearEnd)],
  ]
  const boxes = (from: string[]) => ret.boxes.filter((b) => from.includes(b.box))
  const head = (
    <View style={[s.row, { backgroundColor: "#f1f1f1" }]}>
      <Text style={{ width: 24, padding: 3, fontWeight: "bold" }}> </Text>
      <Text style={{ flex: 1, padding: 3, fontWeight: "bold" }}>Description</Text>
      <Text style={[s.num, { fontWeight: "bold" }]}>Amount (AED)</Text>
      <Text style={[s.num, { fontWeight: "bold" }]}>VAT Amount (AED)</Text>
      <Text style={[s.num, { fontWeight: "bold" }]}>Adjustment (AED)</Text>
    </View>
  )
  const table = (list: VatReturn["boxes"], total: string) =>
    list.map((b) => (
      <View key={b.box} style={[s.row, b.box === total ? { backgroundColor: "#d9d9d9" } : {}]} wrap={false}>
        <Text style={{ width: 24, padding: 3, fontWeight: b.box === total ? "bold" : "normal" }}>{b.box}</Text>
        <Text style={{ flex: 1, padding: 3, fontWeight: b.box === total ? "bold" : "normal" }}>{b.label}</Text>
        <Text style={s.num}>{b.box === "2" ? "" : aed(b.amount)}</Text>
        <Text style={s.num}>{b.box === "4" || b.box === "5" ? "" : aed(b.vat)}</Text>
        <Text style={s.num}>{["2", "3", "4", "5", "6", "7", "10"].includes(b.box) ? "" : aed(b.adjustment)}</Text>
      </View>
    ))
  return (
    <Document title={`${company.name} - VAT 201 ${ret.period.end}`} author="FinScope" creator="FinScope">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>VAT 201 Return — worksheet</Text>
        <Text style={s.band}>Taxpayer Information</Text>
        {info.map((cells) => (
          <View key={cells[0]} style={s.row} wrap={false}>
            <Text style={{ width: 110, padding: 3, fontWeight: "bold" }}>{cells[0]}</Text>
            <Text style={{ flex: 1, padding: 3 }}>{cells[1]}</Text>
            <Text style={{ width: 100, padding: 3, fontWeight: "bold" }}>{cells[2]}</Text>
            <Text style={{ width: 130, padding: 3 }}>{cells[3]}</Text>
          </View>
        ))}
        <Text style={s.band}>VAT on Sales and All Other Outputs</Text>
        {head}
        {table(boxes(["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7", "8"]), "8")}
        <Text style={s.band}>VAT on Expenses and All Other Inputs</Text>
        {head}
        {table(boxes(["9", "10", "11"]), "11")}
        <Text style={s.band}>Net VAT Due</Text>
        {boxes(["12", "13", "14"]).map((b) => (
          <View key={b.box} style={[s.row, b.box === "14" ? { backgroundColor: "#d9d9d9" } : {}]}>
            <Text style={{ width: 24, padding: 3 }}>{b.box}</Text>
            <Text style={{ flex: 1, padding: 3, fontWeight: b.box === "14" ? "bold" : "normal" }}>{b.label} (AED)</Text>
            <Text style={[s.num, { fontWeight: b.box === "14" ? "bold" : "normal" }]}>{aed(b.vat)}</Text>
          </View>
        ))}
        <Text style={s.band}>Profit Margin Scheme</Text>
        <View style={s.row}>
          <Text style={{ flex: 1, padding: 3 }}>Did you apply the profit margin scheme in respect of any supplies made during the tax period?</Text>
          <Text style={[s.num, { width: 60 }]}>{answers.profile.profitMarginScheme ? "Yes" : "No"}</Text>
        </View>
        <Text style={s.band}>Authorised Signatory</Text>
        <View style={s.row}>
          <Text style={{ width: 110, padding: 3, fontWeight: "bold" }}>Name in English</Text>
          <Text style={{ flex: 1, padding: 3 }}>{answers.profile.signatoryName || "-"}</Text>
          <Text style={{ width: 70, padding: 3, fontWeight: "bold" }}>Mobile</Text>
          <Text style={{ width: 120, padding: 3 }}>{answers.profile.signatoryMobile || "-"}</Text>
        </View>

        <View break>
          <Text style={s.title}>VAT working</Text>
          <Text style={[s.para, { fontWeight: "bold" }]}>Basis: {ret.coverage === "Actual totals" ? "actual period totals entered, split by each head's VAT treatment" : ret.coverage === "Estimated" ? "estimated from the saved trial balance" : ret.coverage}.</Text>
          {ret.commentary.map((text) => (
            <Text key={text} style={s.para}>
              {text}
            </Text>
          ))}
          <Text style={s.para}>Registration ({registration.rule}): {registration.result}</Text>
          <Text style={s.band}>Line working</Text>
          <View style={[s.row, { backgroundColor: "#f1f1f1" }]}>
            <Text style={{ flex: 1, padding: 3, fontWeight: "bold" }}>Description</Text>
            <Text style={[s.num, { fontWeight: "bold" }]}>Amount</Text>
            <Text style={{ width: 52, padding: 3, fontWeight: "bold" }}>Rule</Text>
            <Text style={[s.num, { width: 64, fontWeight: "bold" }]}>VAT</Text>
            <Text style={[s.num, { width: 64, fontWeight: "bold" }]}>Recoverable</Text>
          </View>
          {ret.lines.map((l, i) => (
            <View key={`${l.id}-${i}`} style={s.row} wrap={false}>
              <Text style={{ flex: 1, padding: 3 }}>
                {l.name} <Text style={{ color: "#666" }}>({l.side === "revenue" ? "income" : "expense"})</Text>
              </Text>
              <Text style={s.num}>{aed(l.amount)}</Text>
              <Text style={{ width: 52, padding: 3 }}>{l.rule}</Text>
              <Text style={[s.num, { width: 64 }]}>{aed(l.vat)}</Text>
              <Text style={[s.num, { width: 64 }]}>{l.side === "expense" ? aed(l.recoverable) : ""}</Text>
            </View>
          ))}
          {ret.review.length > 0 && (
            <>
              <Text style={s.band}>Needs review</Text>
              {ret.review.map((text) => (
                <Text key={text} style={[s.para, { marginTop: 3 }]}>
                  • {text}
                </Text>
              ))}
            </>
          )}
          <Text style={s.band}>Assumptions made</Text>
          {ret.assumptions.map((text) => (
            <Text key={text} style={[s.para, { marginTop: 3 }]}>
              • {text}
            </Text>
          ))}
        </View>
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${ret.footer} Prepared with FinScope for entry in EmaraTax — not a document issued by the Federal Tax Authority. Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  )
}
