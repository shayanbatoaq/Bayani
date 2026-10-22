import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"

import { formatCurrency } from "@/lib/calculations"
import {
  auditFindings,
  benchmarkRows,
  cfoReportSections,
  corporateTaxItems,
  financialStatements,
  finalReportSections,
  scoreCards,
  vatIntelligence,
} from "@/lib/mock-data"

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    color: "#172734",
    backgroundColor: "#f6f9fa",
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: "#c9d6dd",
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    color: "#2e4455",
    marginBottom: 6,
  },
  subtitle: {
    color: "#5c6d78",
    lineHeight: 1.4,
  },
  section: {
    marginBottom: 14,
    padding: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d4e0e6",
  },
  sectionTitle: {
    fontSize: 14,
    color: "#2e4455",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#eef3f5",
    paddingVertical: 4,
    gap: 12,
  },
  value: {
    color: "#2e4455",
    fontWeight: 700,
  },
  text: {
    lineHeight: 1.5,
    color: "#5c6d78",
  },
  pill: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
})

export function BayaniReportPdf() {
  return (
    <Document
      title="Bayani Executive Report"
      author="Bayani"
      subject="AI CFO, Audit, Tax and Business Intelligence Report"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Bayani Executive Report</Text>
          <Text style={styles.subtitle}>
            Indicative financial intelligence generated from system-calculated outputs. Requires professional review. Not professional advice.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Executive Summary</Text>
          <Text style={styles.text}>
            Business Health Score is 82. The business shows strong margin and liquidity indicators, with audit, VAT, and Corporate Tax documentation requiring focused review.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business Health Score</Text>
          {scoreCards.map((score) => (
            <View key={score.label} style={styles.row}>
              <Text>{score.label}</Text>
              <Text style={styles.value}>{score.value} - {score.risk} risk</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financial Statements</Text>
          {financialStatements[0].rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text>{row.label}</Text>
              <Text>{formatCurrency(row.current)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Industry Comparison</Text>
          {benchmarkRows.map((row) => (
            <View key={row.metric} style={styles.row}>
              <Text>{row.metric}</Text>
              <Text>Company {row.company} | Industry {row.industry}</Text>
            </View>
          ))}
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VAT Intelligence</Text>
          {vatIntelligence.map((item) => (
            <View key={item.label} style={styles.pill}>
              <Text>{item.label}</Text>
              <Text style={styles.value}>{item.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Corporate Tax Intelligence</Text>
          {corporateTaxItems.map((item) => (
            <View key={item.label} style={styles.row}>
              <Text>{item.label}</Text>
              <Text style={styles.text}>{item.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audit Intelligence</Text>
          {auditFindings.slice(0, 4).map((finding) => (
            <Text key={finding} style={styles.text}>- {finding}</Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CFO Commentary and Action Plan</Text>
          {cfoReportSections.slice(0, 3).map((section) => (
            <View key={section.title}>
              <Text style={styles.value}>{section.title}</Text>
              {section.bullets.map((bullet) => (
                <Text key={bullet} style={styles.text}>- {bullet}</Text>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Report Sections</Text>
          <Text style={styles.text}>{finalReportSections.join(" | ")}</Text>
        </View>
      </Page>
    </Document>
  )
}
