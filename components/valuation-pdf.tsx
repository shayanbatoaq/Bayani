import "@/lib/pdf-fonts"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { Company } from "@/lib/company"
import type { Valuation } from "@/lib/valuation"

const ink = "#0d1b2e"
const cobalt = "#2f5bff"
const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 54, paddingHorizontal: 40, fontFamily: "Sans", fontSize: 9.4, color: "#111", lineHeight: 1.35 },
  h1: { fontSize: 18, fontWeight: "bold", color: ink, lineHeight: 1.3, marginBottom: 2 },
  h2: { fontSize: 12, fontWeight: "bold", color: ink, lineHeight: 1.3, marginTop: 14, marginBottom: 6 },
  muted: { color: "#555" },
  hero: { backgroundColor: ink, color: "#fff", padding: 16, borderRadius: 6, marginTop: 14, flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderColor: "#ccc", paddingVertical: 4 },
  para: { marginBottom: 4, textAlign: "justify" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, textAlign: "center", fontSize: 7, color: "#777" },
})
const aed = (n: number) => (Math.round(n) || 0).toLocaleString("en-US")
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** Valuation brief: conclusion, method table, how each method was computed, assumptions and limits. */
export function ValuationPdf({ company, v, logo }: { company: Company; v: Valuation; logo?: string | null }) {
  return (
    <Document title={`${company.name} - Business Valuation Brief ${v.year}`} author="FinScope" creator="FinScope">
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={s.h1}>Business valuation brief</Text>
            <Text style={s.muted}>
              {company.name} · Valuation date {v.year} year end · {v.industry.label}
            </Text>
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image src={logo} style={{ maxHeight: 40, maxWidth: 120, objectFit: "contain" }} /> : null}
        </View>

        <View style={s.hero}>
          <View>
            <Text style={{ fontSize: 8, color: "#aab" }}>INDICATIVE EQUITY VALUE (AED)</Text>
            <Text style={{ fontSize: 22, fontWeight: "bold", marginTop: 4, lineHeight: 1.25 }}>{aed(v.value)}</Text>
            <Text style={{ fontSize: 9, color: "#ccd", marginTop: 2 }}>
              Range {aed(v.low)} – {aed(v.high)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 8, color: "#aab" }}>CONFIDENCE</Text>
            <Text style={{ fontSize: 14, fontWeight: "bold", marginTop: 4, lineHeight: 1.25 }}>{v.confidence}</Text>
            <Text style={{ fontSize: 8, color: "#ccd", marginTop: 2 }}>Years used: {v.yearsUsed.join(", ")}</Text>
          </View>
        </View>

        <Text style={s.h2}>Summary</Text>
        {v.summary.map((t, i) => (
          <Text key={i} style={s.para}>
            {t}
          </Text>
        ))}

        <Text style={s.h2}>Methods and weighting</Text>
        <View style={[s.row, { backgroundColor: "#eef1f7" }]}>
          <Text style={{ flex: 1, fontWeight: "bold", paddingLeft: 4 }}>Method</Text>
          <Text style={{ width: 55, fontWeight: "bold" }}>Approach</Text>
          <Text style={{ width: 75, textAlign: "right", fontWeight: "bold" }}>Low</Text>
          <Text style={{ width: 80, textAlign: "right", fontWeight: "bold" }}>Value</Text>
          <Text style={{ width: 75, textAlign: "right", fontWeight: "bold" }}>High</Text>
          <Text style={{ width: 45, textAlign: "right", fontWeight: "bold", paddingRight: 4 }}>Weight</Text>
        </View>
        {v.methods.map((m) => (
          <View key={m.key} style={s.row} wrap={false}>
            <Text style={{ flex: 1, paddingLeft: 4 }}>{m.name}</Text>
            <Text style={{ width: 55 }}>{m.approach}</Text>
            <Text style={{ width: 75, textAlign: "right" }}>{aed(m.low)}</Text>
            <Text style={{ width: 80, textAlign: "right", fontWeight: "bold" }}>{aed(m.value)}</Text>
            <Text style={{ width: 75, textAlign: "right" }}>{aed(m.high)}</Text>
            <Text style={{ width: 45, textAlign: "right", paddingRight: 4 }}>{m.weight ? pct(m.weight) : "Ref."}</Text>
          </View>
        ))}
        <View style={[s.row, { backgroundColor: ink }]}>
          <Text style={{ flex: 1, paddingLeft: 4, color: "#fff", fontWeight: "bold" }}>Weighted conclusion</Text>
          <Text style={{ width: 80, textAlign: "right", color: "#fff", fontWeight: "bold", paddingRight: 4 }}>{aed(v.value)}</Text>
        </View>

        <Text style={s.h2}>How each method reached its figure</Text>
        {v.methods.map((m) => (
          <View key={m.key} style={{ marginBottom: 6 }} wrap={false}>
            <Text style={{ fontWeight: "bold", color: cobalt }}>
              {m.name} · {m.approach} approach
            </Text>
            {m.explanation.map((t, i) => (
              <Text key={i} style={s.para}>
                • {t}
              </Text>
            ))}
          </View>
        ))}

        <View wrap={false}>
          <Text style={s.h2}>Discount rate build-up</Text>
          {v.discountBuild.map((d) => (
            <View key={d.label} style={s.row}>
              <Text style={{ flex: 1, paddingLeft: 4 }}>{d.label}</Text>
              <Text style={{ width: 60, textAlign: "right", paddingRight: 4 }}>{pct(d.value)}</Text>
            </View>
          ))}
          <View style={[s.row, { backgroundColor: "#eef1f7" }]}>
            <Text style={{ flex: 1, paddingLeft: 4, fontWeight: "bold" }}>Discount rate used · terminal growth {pct(v.terminalGrowth)}</Text>
            <Text style={{ width: 60, textAlign: "right", paddingRight: 4, fontWeight: "bold" }}>{pct(v.discountRate)}</Text>
          </View>
        </View>

        {v.projection.length > 0 && (
          <View wrap={false}>
            <Text style={s.h2}>Cash flow projection (DCF)</Text>
            <View style={[s.row, { backgroundColor: "#eef1f7" }]}>
              {["Year", "Revenue", "EBITDA", "Free cash flow", "Present value"].map((h, i) => (
                <Text key={h} style={{ flex: 1, textAlign: i ? "right" : "left", fontWeight: "bold", paddingHorizontal: 4 }}>
                  {h}
                </Text>
              ))}
            </View>
            {v.projection.map((p) => (
              <View key={p.year} style={s.row}>
                <Text style={{ flex: 1, paddingHorizontal: 4 }}>{p.year}</Text>
                <Text style={{ flex: 1, textAlign: "right", paddingHorizontal: 4 }}>{aed(p.revenue)}</Text>
                <Text style={{ flex: 1, textAlign: "right", paddingHorizontal: 4 }}>{aed(p.ebitda)}</Text>
                <Text style={{ flex: 1, textAlign: "right", paddingHorizontal: 4 }}>{aed(p.fcf)}</Text>
                <Text style={{ flex: 1, textAlign: "right", paddingHorizontal: 4 }}>{aed(p.discounted)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.h2}>What drives the value</Text>
        {v.drivers.map((t, i) => (
          <Text key={i} style={s.para}>
            • {t}
          </Text>
        ))}
        <Text style={s.h2}>Limitations</Text>
        {v.limitations.map((t, i) => (
          <Text key={i} style={s.para}>
            • {t}
          </Text>
        ))}
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${company.name} · Indicative valuation prepared with FinScope from the saved financial statements; not a formal valuation opinion · Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  )
}
