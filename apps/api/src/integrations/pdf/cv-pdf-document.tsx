import type { CvView, CvViewEducation, CvViewRole } from '@cv-builder/shared';
import { Document, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Fragment } from 'react';

/**
 * The design draws its A4 page at 96 dpi (794 × 1123 px); PDF points are 1/72 inch. Styles below
 * keep the design's pixel values (from the web app's `cv-page.css`) and convert them here.
 */
const px = (value: number) => value * 0.75;
/** CSS `em` letter spacing, in points, at a font size given in pixels. */
const em = (value: number, fontSizePx: number) => value * px(fontSizePx);

export const PDF_FONT_FAMILY = 'Geist';

const ACCENT = '#4655EB';
/** `color-mix(in oklab, #4655EB 70%, #fff)`: the bullet dots. */
const BULLET_DOT = '#758DF6';

/** Line heights of the paragraphs, from the page's CSS; used to keep a heading with its text. */
const PROSE_LINE = px(12.5 * 1.6);
const CHIP_ROW = px(2 + 11.5 * 1.45 + 2);

// A unitless lineHeight is resolved against the fontSize of the same style, so every text style
// sets both. Weight 650 in the design is drawn as 600: only 400–700 in steps of 100 are embedded.
const styles = StyleSheet.create({
  page: {
    paddingTop: px(56),
    paddingRight: px(64),
    paddingBottom: px(52),
    paddingLeft: px(64),
    backgroundColor: '#FFFFFF',
    color: '#1C1C22',
    fontFamily: PDF_FONT_FAMILY,
    fontSize: px(12.5),
    lineHeight: 1.55,
  },
  name: {
    color: '#111114',
    fontSize: px(30),
    lineHeight: 1.1,
    fontWeight: 600,
    letterSpacing: em(-0.022, 30),
  },
  headline: {
    marginTop: px(5),
    color: ACCENT,
    fontSize: px(14),
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: em(-0.005, 14),
  },
  contact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: px(3),
    marginTop: px(5 + 7),
  },
  // Each item after the first starts with a 3px dot and 9px either side, drawn in its padding (as
  // the design's `::before`), so a long item wraps within the line instead of running past it.
  contactItem: {
    maxWidth: '100%',
  },
  contactItemAfterDot: {
    paddingLeft: px(9 + 3 + 9),
  },
  contactDot: {
    position: 'absolute',
    top: px((11.5 * 1.45 - 3) / 2),
    left: px(9),
    width: px(3),
    height: px(3),
    borderRadius: px(1.5),
    backgroundColor: '#B5B5BF',
  },
  contactText: {
    color: '#4A4A55',
    fontSize: px(11.5),
    lineHeight: 1.45,
  },
  link: {
    color: '#4A4A55',
    textDecoration: 'none',
  },
  rule: {
    height: px(1),
    marginTop: px(18),
    backgroundColor: '#E4E4EA',
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: px(19),
    marginBottom: px(9),
  },
  headingText: {
    color: '#3B3B43',
    fontSize: px(10.5),
    lineHeight: 1.2,
    fontWeight: 700,
    // The design tracks headings by .14em. PDF text extractors (pdf.js, Poppler, PDFBox: what
    // applicant tracking systems read with) take gaps over about .1em for spaces, which would
    // turn "EXPERIENCE" into "E X P E R I E N C E"; .08em keeps both the look and the words.
    letterSpacing: em(0.08, 10.5),
    textTransform: 'uppercase',
  },
  headingLine: {
    flexGrow: 1,
    height: px(1),
    marginLeft: px(10),
    backgroundColor: '#ECECF0',
  },
  prose: {
    color: '#2E2E36',
    fontSize: px(12.5),
    lineHeight: 1.6,
  },
  entry: {
    marginTop: px(13),
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  role: {
    // Takes what the dates leave, so a long title wraps beside them.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    color: '#141418',
    fontSize: px(13.5),
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: em(-0.008, 13.5),
  },
  dates: {
    flexShrink: 0,
    // The design aligns the dates to the title's baseline; with the smaller text, that is 2px down.
    marginTop: px(2),
    marginLeft: px(16),
    color: '#55555E',
    fontSize: px(11.5),
    lineHeight: 1.35,
    fontWeight: 500,
  },
  org: {
    marginTop: px(5 - 2),
    color: '#4A4A55',
    fontSize: px(12),
    lineHeight: 1.4,
  },
  company: {
    color: '#2B2B33',
    fontWeight: 600,
  },
  // The text is indented 14px; the dot sits in that indent, .62em below the first line's top.
  bullet: {
    marginTop: px(3),
    paddingLeft: px(14),
  },
  firstBullet: {
    marginTop: px(5 + 2),
  },
  bulletDot: {
    position: 'absolute',
    top: em(0.62, 12.5),
    left: px(2),
    width: px(4),
    height: px(4),
    borderRadius: px(2),
    backgroundColor: BULLET_DOT,
  },
  bulletText: {
    color: '#2E2E36',
    fontSize: px(12.5),
    lineHeight: 1.55,
  },
  details: {
    marginTop: px(5),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: px(5),
    columnGap: px(5),
  },
  chip: {
    paddingVertical: px(2),
    paddingHorizontal: px(8),
    borderRadius: px(4),
    backgroundColor: '#F2F2F5',
  },
  chipText: {
    color: '#2B2B33',
    fontSize: px(11.5),
    lineHeight: 1.45,
    fontWeight: 500,
  },
});

/**
 * A section heading: the title in small capitals, then a hairline to the right edge.
 * `minPresenceAhead` keeps it off the bottom of a page unless that much of what follows fits too.
 */
function Heading({ title, minPresenceAhead }: { title: string; minPresenceAhead?: number }) {
  return (
    <View style={styles.heading} minPresenceAhead={minPresenceAhead}>
      <Text style={styles.headingText}>{title}</Text>
      <View style={styles.headingLine} />
    </View>
  );
}

/** A role or degree, with its dates set flush right. */
function EntryRow({ title, dates }: { title: string; dates: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.role}>{title}</Text>
      {dates ? <Text style={styles.dates}>{dates}</Text> : null}
    </View>
  );
}

/** "Northpay · Lisbon", either part optional, the company in bold. */
function OrgLine({ org, location }: { org: string; location: string }) {
  if (!org && !location) return null;
  return (
    <Text style={styles.org}>
      {org ? <Text style={styles.company}>{org}</Text> : null}
      {org && location ? ` · ${location}` : location}
    </Text>
  );
}

function Bullet({ text, first, wrap }: { text: string; first?: boolean; wrap?: false }) {
  return (
    <View style={first ? [styles.bullet, styles.firstBullet] : styles.bullet} wrap={wrap}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

/**
 * A role, as blocks laid directly on the page: its heading, title, company and first achievement
 * never part (so a heading or a title never ends a page alone), and each further achievement moves
 * to the next page whole. Every block is short enough to fit on a page (see `CV_LIMITS`).
 */
function Role({ role, first }: { role: CvViewRole; first: boolean }) {
  const [lead, ...rest] = role.bullets;
  return (
    <Fragment>
      <View wrap={false} style={first ? undefined : styles.entry}>
        {first ? <Heading title="Experience" /> : null}
        <EntryRow title={role.title} dates={role.dates} />
        <OrgLine org={role.company} location={role.location} />
        {lead ? <Bullet text={lead.text} first /> : null}
      </View>
      {rest.map((bullet) => (
        <Bullet key={bullet.id} text={bullet.text} wrap={false} />
      ))}
    </Fragment>
  );
}

/**
 * A degree: its heading, title and school never part. The details keep their line breaks, so they
 * can run longer than a page: they flow on, with at least two lines kept beside the title.
 */
function Degree({ entry, first }: { entry: CvViewEducation; first: boolean }) {
  return (
    <Fragment>
      <View
        wrap={false}
        style={first ? undefined : styles.entry}
        minPresenceAhead={entry.details ? px(5) + 2 * PROSE_LINE : undefined}
      >
        {first ? <Heading title="Education" /> : null}
        <EntryRow title={entry.title} dates={entry.dates} />
        <OrgLine org={entry.school} location={entry.location} />
      </View>
      {entry.details ? <Text style={[styles.prose, styles.details]}>{entry.details}</Text> : null}
    </Fragment>
  );
}

/**
 * The CV as an A4 PDF: the design's CV template (the web app's `CvPage`), drawn from the same
 * `CvView`. Every block is a direct child of the page, because react-pdf keeps blocks together
 * (`wrap={false}`, `minPresenceAhead`) only among siblings; see `Role` and `Degree`.
 */
export function CvPdfDocument({ view }: { view: CvView }) {
  const [firstContact] = view.contact;
  return (
    <Document
      title={`${view.name} — CV`}
      author={view.name}
      subject={view.headline || undefined}
      creator="CV Builder"
      producer="CV Builder"
    >
      <Page size="A4" style={styles.page}>
        <View wrap={false}>
          <Text style={styles.name}>{view.name}</Text>
          {view.headline ? <Text style={styles.headline}>{view.headline}</Text> : null}
          {firstContact ? (
            <View style={styles.contact}>
              {view.contact.map((item) => (
                <View
                  key={item.key}
                  style={
                    item === firstContact
                      ? styles.contactItem
                      : [styles.contactItem, styles.contactItemAfterDot]
                  }
                >
                  {item === firstContact ? null : <View style={styles.contactDot} />}
                  <Text style={styles.contactText}>
                    {item.href ? (
                      <Link href={item.href} style={styles.link}>
                        {item.text}
                      </Link>
                    ) : (
                      item.text
                    )}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.rule} />
        </View>

        {view.summary ? (
          <Fragment>
            <Heading title="Summary" minPresenceAhead={2 * PROSE_LINE} />
            <Text style={styles.prose}>{view.summary}</Text>
          </Fragment>
        ) : null}

        {view.experience.map((role, index) => (
          <Role key={role.id} role={role} first={index === 0} />
        ))}

        {view.education.map((entry, index) => (
          <Degree key={entry.id} entry={entry} first={index === 0} />
        ))}

        {view.skills.length > 0 ? (
          <Fragment>
            <Heading title="Skills" minPresenceAhead={CHIP_ROW} />
            <View style={styles.chips}>
              {view.skills.map((skill) => (
                <View key={skill.id} style={styles.chip} wrap={false}>
                  <Text style={styles.chipText}>{skill.name}</Text>
                </View>
              ))}
            </View>
          </Fragment>
        ) : null}
      </Page>
    </Document>
  );
}
