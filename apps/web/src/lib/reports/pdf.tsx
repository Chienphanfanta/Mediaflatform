// PDF renderer dùng @react-pdf/renderer (Node-only).
// LƯU Ý: font Helvetica mặc định KHÔNG support đầy đủ Vietnamese diacritics.
// V2 stripped: bỏ ContentReportPdf, bỏ topPosts/postCount cột channel, bỏ task/post cột HR.
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type {
  ChannelReportData,
  HRReportData,
  ReportData,
} from '@/lib/types/reports';

const colors = {
  primary: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  bg: '#F8FAFC',
  positive: '#10B981',
  negative: '#EF4444',
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: colors.primary },
  header: { borderBottom: `2 solid ${colors.primary}`, paddingBottom: 8, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700 },
  subtitle: { fontSize: 10, color: colors.muted, marginTop: 4 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8 },
  table: { borderTop: `1 solid ${colors.border}` },
  tr: {
    flexDirection: 'row',
    borderBottom: `1 solid ${colors.border}`,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  trHeader: { backgroundColor: colors.bg, fontWeight: 700, fontSize: 9 },
  trZebra: { backgroundColor: '#FBFBFD' },
  td: { paddingHorizontal: 2 },
  totalsBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
    backgroundColor: colors.bg,
    borderRadius: 4,
    marginBottom: 12,
  },
  totalCell: { width: '23%', padding: 4 },
  totalLabel: { fontSize: 8, color: colors.muted, textTransform: 'uppercase' },
  totalValue: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 8,
    color: colors.muted,
    textAlign: 'center',
    borderTop: `1 solid ${colors.border}`,
    paddingTop: 6,
  },
});

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtPct(n: number | null): string {
  if (n === null || !isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function deltaColor(d: number | null | undefined) {
  if (typeof d !== 'number') return {};
  if (d > 0) return { color: colors.positive };
  if (d < 0) return { color: colors.negative };
  return {};
}

function Header({ title, period, generatedAt }: { title: string; period: string; generatedAt: string }) {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>
        {period} · Generated {generatedAt.slice(0, 19).replace('T', ' ')} UTC
      </Text>
    </View>
  );
}

function Footer() {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) =>
        `Media Ops Platform Report · Page ${pageNumber} / ${totalPages}`
      }
    />
  );
}

function TotalCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalCell}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}

function ChannelReportPdf({ data }: { data: ChannelReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Header
          title="Channel Performance Report"
          period={`${data.period.from} - ${data.period.to} (${data.period.days} days)`}
          generatedAt={data.generatedAt}
        />

        <View style={styles.totalsBox}>
          <TotalCell label="Channels" value={String(data.totals.channels)} />
          <TotalCell label="Total Views" value={fmtCompact(data.totals.views)} />
          <TotalCell label="Watch Time" value={`${fmtCompact(data.totals.watchTimeHours)}h`} />
          <TotalCell label="Subscribers +" value={fmtCompact(data.totals.subscribersGained)} />
          <TotalCell label="Revenue (USD)" value={`$${data.totals.revenue.toFixed(2)}`} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Channel breakdown</Text>
          <View style={styles.table}>
            <View style={[styles.tr, styles.trHeader]}>
              <Text style={[styles.td, { width: '32%' }]}>Channel</Text>
              <Text style={[styles.td, { width: '14%' }]}>Platform</Text>
              <Text style={[styles.td, { width: '14%', textAlign: 'right' }]}>Views</Text>
              <Text style={[styles.td, { width: '14%', textAlign: 'right' }]}>Δ Views</Text>
              <Text style={[styles.td, { width: '13%', textAlign: 'right' }]}>Watch h</Text>
              <Text style={[styles.td, { width: '13%', textAlign: 'right' }]}>Subs+</Text>
            </View>
            {data.channels.map((c, i) => (
              <View
                key={c.id}
                style={[styles.tr, i % 2 === 1 ? styles.trZebra : {}]}
                wrap={false}
              >
                <Text style={[styles.td, { width: '32%' }]}>{c.name}</Text>
                <Text style={[styles.td, { width: '14%' }]}>{c.platform}</Text>
                <Text style={[styles.td, { width: '14%', textAlign: 'right' }]}>
                  {fmtCompact(c.views)}
                </Text>
                <Text
                  style={[
                    styles.td,
                    { width: '14%', textAlign: 'right' },
                    deltaColor(c.viewsDeltaPct),
                  ]}
                >
                  {fmtPct(c.viewsDeltaPct)}
                </Text>
                <Text style={[styles.td, { width: '13%', textAlign: 'right' }]}>
                  {c.watchTimeHours.toFixed(1)}
                </Text>
                <Text style={[styles.td, { width: '13%', textAlign: 'right' }]}>
                  {fmtCompact(c.subscribersGained)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Footer />
      </Page>
    </Document>
  );
}

function HRReportPdf({ data }: { data: HRReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Header
          title="HR Activity Report"
          period={`${data.period.from} - ${data.period.to}`}
          generatedAt={data.generatedAt}
        />

        <View style={styles.totalsBox}>
          <TotalCell label="Members" value={String(data.totals.members)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Member list</Text>
          <View style={styles.table}>
            <View style={[styles.tr, styles.trHeader]}>
              <Text style={[styles.td, { width: '28%' }]}>Name</Text>
              <Text style={[styles.td, { width: '32%' }]}>Email</Text>
              <Text style={[styles.td, { width: '15%' }]}>Role</Text>
              <Text style={[styles.td, { width: '25%' }]}>Groups</Text>
            </View>
            {data.members.map((m, i) => (
              <View key={m.id} style={[styles.tr, i % 2 === 1 ? styles.trZebra : {}]} wrap={false}>
                <Text style={[styles.td, { width: '28%' }]}>{m.name}</Text>
                <Text style={[styles.td, { width: '32%', color: colors.muted }]}>{m.email}</Text>
                <Text style={[styles.td, { width: '15%' }]}>{m.role}</Text>
                <Text style={[styles.td, { width: '25%' }]}>{m.groups.join(', ')}</Text>
              </View>
            ))}
          </View>
        </View>

        <Footer />
      </Page>
    </Document>
  );
}

export async function reportToPdfBuffer(data: ReportData): Promise<Buffer> {
  let element;
  switch (data.type) {
    case 'CHANNEL':
      element = <ChannelReportPdf data={data} />;
      break;
    case 'HR':
      element = <HRReportPdf data={data} />;
      break;
  }
  return renderToBuffer(element!);
}
