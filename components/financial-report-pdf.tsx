import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { FinancialRecord } from "@/lib/financial-statements"
import type { ReportSheet } from "@/lib/financial-workbook"

const styles = StyleSheet.create({
  page: {
    padding: 34,
    fontFamily: "Times-Roman",
    fontSize: 10,
    color: "#172734",
  },
  title: { fontSize: 16, marginBottom: 8, fontFamily: "Times-Bold" },
  subtitle: { fontSize: 11, marginBottom: 16 },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.4,
    borderBottomColor: "#ccd4da",
  },
  label: { width: "55%", paddingRight: 10 },
  value: { width: "20%", textAlign: "right" },
  note: { marginTop: 12, fontSize: 9 },
  footer: { position: "absolute", bottom: 18, left: 34, fontSize: 8 },
})
const amount = (value: number | null) =>
  value === null
    ? "n.a."
    : (value === 0 ? 0 : value).toLocaleString("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

export function FinancialReportPdf({
  records,
  sheets,
}: {
  records: FinancialRecord[]
  sheets: ReportSheet[]
}) {
  return (
    <Document
      title={`${records[0].clientName} financial statements`}
      author="FinScope AI"
    >
      {records.flatMap((record) =>
        sheets.map((sheet) => (
          <Page
            key={`${record.id}-${sheet}`}
            size="A4"
            orientation={sheet === "EQUITY" ? "landscape" : "portrait"}
            style={styles.page}
          >
            <View fixed>
              <Text style={styles.title}>{record.clientName}</Text>
              <Text style={styles.subtitle}>
                {sheet === "BS"
                  ? "STATEMENT OF FINANCIAL POSITION"
                  : sheet === "INCOME"
                    ? "STATEMENT OF COMPREHENSIVE INCOME"
                    : sheet === "EQUITY"
                      ? "STATEMENT OF CHANGES IN EQUITY"
                      : "NOTES TO THE ACCOUNTS"}
                {"\n"}31 December {record.year} · {record.currency}
              </Text>
            </View>
            {sheet === "EQUITY" ? (
              <>
                <View style={styles.row}>
                  <Text style={{ width: "30%" }} />
                  {[
                    "Share capital",
                    "Current year earnings",
                    "Retained earnings",
                    "Shareholders current account",
                    "Total",
                  ].map((label) => (
                    <Text
                      key={label}
                      style={{ width: "14%", textAlign: "right" }}
                    >
                      {label}
                    </Text>
                  ))}
                </View>
                {record.statements.equity.map((line) => (
                  <View
                    key={line.label}
                    style={{
                      ...styles.row,
                      fontFamily: line.kind ? "Times-Bold" : "Times-Roman",
                    }}
                    wrap={false}
                  >
                    <Text style={{ width: "30%" }}>{line.label}</Text>
                    {line.values.map((value, index) => (
                      <Text
                        key={index}
                        style={{ width: "14%", textAlign: "right" }}
                      >
                        {amount(value)}
                      </Text>
                    ))}
                  </View>
                ))}
              </>
            ) : (
              (sheet === "BS"
                ? record.statements.bs
                : sheet === "INCOME"
                  ? record.statements.income
                  : record.statements.schedules
              ).map((line) => (
                <View
                  key={line.row}
                  style={{
                    ...styles.row,
                    fontFamily: line.kind ? "Times-Bold" : "Times-Roman",
                  }}
                  wrap={false}
                >
                  <Text style={styles.label}>{line.label}</Text>
                  <Text style={{ width: "25%", textAlign: "center" }}>
                    {line.note ?? ""}
                  </Text>
                  <Text style={styles.value}>
                    {line.kind === "heading" ? "" : amount(line.amount)}
                  </Text>
                </View>
              ))
            )}
            <Text style={styles.note}>
              Management financial statements. Not an audit opinion.
            </Text>
            {record.statements.warnings.map((warning) => (
              <Text key={warning} style={styles.note}>
                {warning}
              </Text>
            ))}
            <Text
              style={styles.footer}
              fixed
              render={({ pageNumber, totalPages }) =>
                `FinScope AI · ${pageNumber} / ${totalPages}`
              }
            />
          </Page>
        ))
      )}
    </Document>
  )
}
