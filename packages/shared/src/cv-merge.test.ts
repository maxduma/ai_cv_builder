import { describe, expect, it } from 'vitest';
import type { CvContent } from './cv-content';
import { changedPaths, mergeCvContent } from './cv-merge';

const BASE: CvContent = {
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Backend Engineer',
    email: 'alex@example.com',
    phone: '',
    location: 'Lisbon',
    workSetup: '',
    links: [{ id: 'link-1', label: 'GitHub', url: 'github.com/alex' }],
  },
  summary: 'Builds payment systems.',
  experience: [
    {
      id: 'e1',
      title: 'Backend Engineer',
      company: 'Northpay',
      location: 'Lisbon',
      start: '2021',
      end: '',
      current: true,
      bullets: [
        { id: 'b1', text: 'Led the payments API.' },
        { id: 'b2', text: 'Moved billing to Kafka.' },
        { id: 'b3', text: 'Added contract tests.' },
      ],
    },
    {
      id: 'e2',
      title: 'Engineer',
      company: 'Cartwell',
      location: '',
      start: '2018',
      end: '2021',
      current: false,
      bullets: [],
    },
    {
      id: 'e3',
      title: 'Intern',
      company: 'Fieldline',
      location: '',
      start: '2016',
      end: '2018',
      current: false,
      bullets: [],
    },
  ],
  education: [],
  skills: [
    { id: 's1', name: 'Go' },
    { id: 's2', name: 'Kafka' },
  ],
};

type Draft = { -readonly [K in keyof CvContent]: CvContent[K] };

/** A copy of `BASE` changed by `edit`. */
function edited(edit: (cv: Draft) => void, from: CvContent = BASE): CvContent {
  const copy = JSON.parse(JSON.stringify(from)) as Draft;
  edit(copy);
  return copy;
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('mergeCvContent', () => {
  it('returns either side when only it changed, and either when both made the same change', () => {
    const changed = edited((cv) => {
      cv.summary = 'Builds payment systems at scale.';
    });

    expect(mergeCvContent(BASE, changed, BASE)).toEqual(changed);
    expect(mergeCvContent(BASE, BASE, changed)).toEqual(changed);
    expect(mergeCvContent(BASE, changed, changed)).toEqual(changed);
  });

  it('keeps edits to different fields of the same entry from both sides', () => {
    const ours = edited((cv) => {
      cv.experience[0]!.title = 'Senior Backend Engineer';
    });
    const theirs = edited((cv) => {
      cv.experience[0]!.location = 'Lisbon · Remote';
      cv.experience[0]!.bullets[1]!.text = 'Moved billing to Kafka, cutting latency by 40%.';
    });

    const merged = mergeCvContent(BASE, ours, theirs);

    expect(merged.experience[0]).toMatchObject({
      title: 'Senior Backend Engineer',
      location: 'Lisbon · Remote',
    });
    expect(merged.experience[0]!.bullets[1]!.text).toBe(
      'Moved billing to Kafka, cutting latency by 40%.',
    );
  });

  it('keeps our value when both sides changed the same field', () => {
    const ours = edited((cv) => {
      cv.summary = 'Written by hand.';
    });
    const theirs = edited((cv) => {
      cv.summary = 'Written by the AI.';
    });

    expect(mergeCvContent(BASE, ours, theirs).summary).toBe('Written by hand.');
  });

  it('adds entries from both sides', () => {
    const ours = edited((cv) => {
      cv.skills.push({ id: 's-ours', name: 'Rust' });
    });
    const theirs = edited((cv) => {
      cv.skills.push({ id: 's-theirs', name: 'Terraform' });
      cv.experience[0]!.bullets.push({ id: 'b-new', text: 'Mentored two engineers.' });
    });

    const merged = mergeCvContent(BASE, ours, theirs);

    expect(ids(merged.skills)).toEqual(['s1', 's2', 's-theirs', 's-ours']);
    expect(ids(merged.experience[0]!.bullets)).toEqual(['b1', 'b2', 'b3', 'b-new']);
  });

  it('keeps entries deleted on either side deleted, unless the other side edited them', () => {
    const ours = edited((cv) => {
      cv.experience[0]!.bullets.splice(2, 1); // b3
    });
    const theirs = edited((cv) => {
      cv.experience[0]!.bullets.splice(0, 1); // b1
      cv.skills.splice(1, 1); // s2
    });

    const merged = mergeCvContent(BASE, ours, theirs);
    expect(ids(merged.experience[0]!.bullets)).toEqual(['b2']);
    expect(ids(merged.skills)).toEqual(['s1']);

    const oursEditsDeleted = edited((cv) => {
      cv.skills[1]!.name = 'Apache Kafka';
    });
    expect(ids(mergeCvContent(BASE, oursEditsDeleted, theirs).skills)).toEqual(['s1', 's2']);
  });

  it('places an entry added next to one the other side deleted', () => {
    const ours = edited((cv) => {
      cv.experience[0]!.bullets.splice(2, 1); // b3
    });
    const theirs = edited((cv) => {
      cv.experience[0]!.bullets.splice(2, 0, { id: 'b-new', text: 'Cut costs by a third.' });
    });

    const merged = mergeCvContent(BASE, ours, theirs);

    expect(ids(merged.experience[0]!.bullets)).toEqual(['b1', 'b2', 'b-new']);
  });

  it('keeps our order when we reordered, and adds their new entries at the end', () => {
    const ours = edited((cv) => {
      cv.experience.reverse(); // e3, e2, e1
    });
    const theirs = edited((cv) => {
      cv.experience.push({ ...BASE.experience[2]!, id: 'e4', title: 'New' });
    });

    expect(ids(mergeCvContent(BASE, ours, theirs).experience)).toEqual(['e3', 'e2', 'e1', 'e4']);
  });

  it('takes a reorder made on their side when we only edited', () => {
    const ours = edited((cv) => {
      cv.experience[1]!.title = 'Software Engineer';
      cv.skills.push({ id: 's-ours', name: 'Rust' });
    });
    const theirs = edited((cv) => {
      const [moved] = cv.experience.splice(2, 1);
      cv.experience.unshift(moved!);
    });

    const merged = mergeCvContent(BASE, ours, theirs);

    expect(ids(merged.experience)).toEqual(['e3', 'e1', 'e2']);
    expect(merged.experience[2]!.title).toBe('Software Engineer');
    expect(ids(merged.skills)).toEqual(['s1', 's2', 's-ours']);
  });

  it('merges an entry both sides have but base has not as an echo of ours', () => {
    const added = { id: 's-new', name: 'Rust' };
    const theirs = edited((cv) => {
      cv.skills.push(added);
    });
    const ours = edited((cv) => {
      cv.skills.push({ ...added, name: 'Rust (systems)' });
    });

    expect(mergeCvContent(BASE, ours, theirs).skills.at(-1)).toEqual({
      id: 's-new',
      name: 'Rust (systems)',
    });
  });

  it('treats whether a role is current and its end date as one value', () => {
    const ours = edited((cv) => {
      cv.experience[1]!.end = '2022';
    });
    const theirs = edited((cv) => {
      cv.experience[1]!.current = true;
      cv.experience[1]!.end = '';
    });

    // Ours changed the pair, so ours decides it: the end date typed by hand stays.
    expect(mergeCvContent(BASE, ours, theirs).experience[1]).toMatchObject({
      current: false,
      end: '2022',
    });
    // Only theirs changed it: theirs decides.
    expect(mergeCvContent(BASE, BASE, theirs).experience[1]).toMatchObject({
      current: true,
      end: '',
    });
    // Ours made it current while theirs set an end date: current, without an end.
    const oursCurrent = edited((cv) => {
      cv.experience[1]!.current = true;
      cv.experience[1]!.end = '';
    });
    const theirsEnd = edited((cv) => {
      cv.experience[1]!.end = '2023';
    });
    expect(mergeCvContent(BASE, oursCurrent, theirsEnd).experience[1]).toMatchObject({
      current: true,
      end: '',
    });
  });
});

describe('changedPaths', () => {
  it('names fields by key and entries by id', () => {
    const after = edited((cv) => {
      cv.contact.email = 'alex@northpay.com';
      cv.experience[0]!.bullets[1]!.text = 'Changed.';
      cv.skills.push({ id: 's3', name: 'Rust' });
    });

    expect(changedPaths(BASE, after)).toEqual([
      'contact.email',
      'experience.e1.bullets.b2.text',
      'skills.s3',
    ]);
    expect(changedPaths(BASE, BASE)).toEqual([]);
  });

  it('reports a reorder', () => {
    const after = edited((cv) => {
      cv.skills.reverse();
    });

    expect(changedPaths(BASE, after)).toEqual(['skills.(order)']);
  });
});
