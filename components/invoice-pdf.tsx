import "@/lib/pdf-fonts"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { lineTotals, type Books, type CreditNote, type Invoice, type Party } from "@/lib/books"
import { invoiceStatus } from "@/lib/books-engine"
import type { Company } from "@/lib/company"

const ink = "#0d1b2e"
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Sans", fontSize: 9.5, color: "#1a1a1a", lineHeight: 1.35 },
  title: { fontSize: 20, fontWeight: "bold", color: ink, letterSpacing: 0.5 },
  label: { fontSize: 7.5, color: "#667", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  head: { flexDirection: "row", backgroundColor: ink, color: "#fff", paddingVertical: 5, paddingHorizontal: 6, marginTop: 18, fontWeight: "bold", fontSize: 8.5 },
  row: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderColor: "#d5dae3" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, fontSize: 7.5, color: "#778", textAlign: "center" },
})
const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const date = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "")
const RATE_LABEL: Record<string, string> = { standard: "5%", zero: "0%", exempt: "Exempt", outOfScope: "Out of scope", reverseCharge: "RC" }
const cols = [3.2, 0.8, 1.2, 0.9, 1.1, 1.3]

/** A UAE tax invoice (or plain invoice for a business without a TRN), or a credit note. */
export function InvoicePdf({ company, books, invoice, note, logo }: { company: Company; books: Books; invoice: Invoice; note?: CreditNote; logo?: string | null }) {
  const doc = note ?? invoice
  const client: Party | undefined = books.clients.find((c) => c.id === invoice.clientId)
  const vatRegistered = Boolean(company.vat.trn)
  const title = note ? (vatRegistered ? "TAX CREDIT NOTE" : "CREDIT NOTE") : vatRegistered ? "TAX INVOICE" : "INVOICE"
  const lines = doc.lines.map((l) => ({ ...l, treatment: l.vat, ...lineTotals(l) }))
  const net = lines.reduce((t, l) => t + l.net, 0)
  const vat = lines.reduce((t, l) => t + l.vat, 0)
  const st = invoiceStatus(books, invoice)
  const cur = invoice.currency ?? company.baseCurrency ?? "AED"
  // UAE tax invoices in another currency also state the amounts and VAT in AED.
  const aedPer = cur === "AED" ? 1 : (invoice.aedRate ?? ((company.baseCurrency ?? "AED") === "AED" ? invoice.rate : 0))
  const { settings } = books
  const bank = settings.bank
  return (
    <Document title={`${title} ${doc.number}`} author={company.name} creator="Bayani">
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ maxWidth: 300 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logo ? <Image src={logo} style={{ maxHeight: 54, maxWidth: 160, objectFit: "contain", marginBottom: 8 }} /> : null}
            <Text style={{ fontSize: 12, fontWeight: "bold", color: ink }}>{company.name}</Text>
            {settings.address ? <Text>{settings.address}</Text> : null}
            {settings.phone || settings.email ? <Text>{[settings.phone, settings.email].filter(Boolean).join(" · ")}</Text> : null}
            {vatRegistered ? <Text style={{ marginTop: 2 }}>TRN {company.vat.trn}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>{title}</Text>
            <Text style={{ marginTop: 6 }}>No. {doc.number}</Text>
            <Text>Date {date(doc.date)}</Text>
            {note ? <Text>Against invoice {invoice.number} of {date(invoice.date)}</Text> : invoice.dueDate ? <Text>Due {date(invoice.dueDate)}</Text> : null}
          </View>
        </View>

        <View style={{ marginTop: 22, flexDirection: "row", gap: 20 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{note ? "Credited to" : "Bill to"}</Text>
            <Text style={{ fontWeight: "bold" }}>{client?.name ?? ""}</Text>
            {client?.address ? <Text>{client.address}</Text> : null}
            {client?.email ? <Text>{client.email}</Text> : null}
            {client?.trn ? <Text>TRN {client.trn}</Text> : null}
          </View>
          {note?.reason ? (
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Reason</Text>
              <Text>{note.reason}</Text>
            </View>
          ) : null}
        </View>

        <View style={s.head}>
          {["Description", "Qty", "Rate", "VAT", `VAT (${cur})`, `Amount (${cur})`].map((h, i) => (
            <Text key={h} style={{ flex: cols[i], textAlign: i ? "right" : "left" }}>
              {h}
            </Text>
          ))}
        </View>
        {lines.map((l) => (
          <View key={l.id} style={s.row} wrap={false}>
            <View style={{ flex: cols[0] }}>
              <Text style={{ fontWeight: l.item ? "bold" : "normal" }}>{l.item || l.description}</Text>
              {l.item && l.description ? <Text style={{ color: "#556" }}>{l.description}</Text> : null}
            </View>
            <Text style={{ flex: cols[1], textAlign: "right" }}>{l.quantity}</Text>
            <Text style={{ flex: cols[2], textAlign: "right" }}>{money(l.rate)}</Text>
            <Text style={{ flex: cols[3], textAlign: "right" }}>{vatRegistered ? RATE_LABEL[l.treatment] : "-"}</Text>
            <Text style={{ flex: cols[4], textAlign: "right" }}>{money(l.vat)}</Text>
            <Text style={{ flex: cols[5], textAlign: "right" }}>{money(l.net + l.vat)}</Text>
          </View>
        ))}

        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
          <View style={{ width: 230 }}>
            <View style={s.total}>
              <Text>Total excluding VAT</Text>
              <Text>{money(net)}</Text>
            </View>
            {vatRegistered ? (
              <View style={s.total}>
                <Text>VAT</Text>
                <Text>{money(vat)}</Text>
              </View>
            ) : null}
            <View style={[s.total, { borderTopWidth: 1, borderColor: ink, marginTop: 2, paddingTop: 5 }]}>
              <Text style={{ fontWeight: "bold" }}>{note ? `Total credited (${cur})` : `Total (${cur})`}</Text>
              <Text style={{ fontWeight: "bold" }}>{money(net + vat)}</Text>
            </View>
            {!note && (st.credited > 0 || st.paid > 0) ? (
              <>
                {st.credited > 0 ? (
                  <View style={s.total}>
                    <Text>Credit notes</Text>
                    <Text>({money(st.credited)})</Text>
                  </View>
                ) : null}
                {st.paid > 0 ? (
                  <View style={s.total}>
                    <Text>Paid</Text>
                    <Text>({money(st.paid)})</Text>
                  </View>
                ) : null}
              </>
            ) : null}
            {!note ? (
              <View style={[s.total, { backgroundColor: "#eef2f7", paddingHorizontal: 6, marginTop: 4 }]}>
                <Text style={{ fontWeight: "bold" }}>Amount due ({cur})</Text>
                <Text style={{ fontWeight: "bold" }}>{money(st.due)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {cur !== "AED" && aedPer > 0 ? (
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }} wrap={false}>
            <View style={{ width: 230, borderWidth: 0.6, borderColor: "#c9d0db", padding: 6 }}>
              <Text style={[s.label, { marginBottom: 4 }]}>In AED at 1 {cur} = {aedPer} AED</Text>
              <View style={s.total}>
                <Text>Total excluding VAT (AED)</Text>
                <Text>{money(net * aedPer)}</Text>
              </View>
              {vatRegistered ? (
                <View style={s.total}>
                  <Text>VAT (AED)</Text>
                  <Text>{money(vat * aedPer)}</Text>
                </View>
              ) : null}
              <View style={s.total}>
                <Text style={{ fontWeight: "bold" }}>Total (AED)</Text>
                <Text style={{ fontWeight: "bold" }}>{money((net + vat) * aedPer)}</Text>
              </View>
            </View>
          </View>
        ) : null}
        {!note && (bank.iban || bank.accountNumber) ? (
          <View style={{ marginTop: 22 }} wrap={false}>
            <Text style={s.label}>Payment details</Text>
            {bank.accountName ? <Text>Account name: {bank.accountName}</Text> : null}
            {bank.bankName ? <Text>Bank: {bank.bankName}</Text> : null}
            {bank.iban ? <Text>IBAN: {bank.iban}</Text> : null}
            {bank.accountNumber ? <Text>Account number: {bank.accountNumber}</Text> : null}
            {bank.swift ? <Text>SWIFT: {bank.swift}</Text> : null}
          </View>
        ) : null}
        {!note && invoice.notes ? (
          <View style={{ marginTop: 14 }}>
            <Text style={s.label}>Notes</Text>
            <Text>{invoice.notes}</Text>
          </View>
        ) : null}
        <Text style={s.footer} fixed>
          {settings.footer || (vatRegistered ? `${company.name} · TRN ${company.vat.trn}` : company.name)}
        </Text>
      </Page>
    </Document>
  )
}
