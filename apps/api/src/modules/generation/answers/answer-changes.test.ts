import { type CvContent, CvContentSchema } from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import { applyAnswerChanges, CONTACT_FOLLOW_UPS, resolveAnswer } from './answer-changes';
import type { AnswerRequest } from './answer-input';
import type {
  AnswerSection,
  AnswerUpdate,
  ContactChanges,
  EducationChanges,
  RoleChanges,
} from './answer-update.schema';

const CV: CvContent = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Backend Engineer',
    email: 'alex@example.com',
    phone: '',
    location: 'Lisbon',
    workSetup: '',
    links: [{ id: 'l1', label: 'GitHub', url: 'https://github.com/alexmorgan' }],
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
  ],
  education: [
    {
      id: 'ed1',
      degree: 'BSc Computer Science',
      school: 'University of Lisbon',
      location: '',
      start: '2014',
      end: '2017',
      details: '',
    },
  ],
  skills: [
    { id: 's1', name: 'Go' },
    { id: 's2', name: 'Kafka' },
  ],
});

/** A copy of `from` changed by `edit`. */
function edited(edit: (cv: CvContent) => void, from: CvContent = CV): CvContent {
  const copy = structuredClone(from);
  edit(copy);
  return copy;
}

interface RequestOptions {
  itemId?: string | null;
  answer?: string;
  /** The AI's earlier request for more detail: set on the second round. */
  followUp?: string | null;
  cv?: CvContent;
}

function request(
  section: AnswerSection,
  { itemId = null, answer = 'An answer.', followUp = null, cv = CV }: RequestOptions = {},
): AnswerRequest {
  return {
    targetRole: 'Senior Backend Engineer',
    question: {
      section,
      kind: 'incomplete',
      target: 'Experience · Northpay',
      itemId,
      question: 'What did you achieve at Northpay?',
      why: 'Results show the impact you can have as a senior engineer.',
    },
    answer,
    followUp,
    previousAnswer: followUp === null ? null : 'Not sure.',
    cv,
  };
}

/** Predictable ids for new entries: new-1, new-2... */
function counter() {
  let last = 0;
  return () => `new-${(last += 1)}`;
}

/** The CV `applyAnswerChanges` builds from `update`; fails if it asked for more detail instead. */
function changed(req: AnswerRequest, update: AnswerUpdate): CvContent {
  const result = applyAnswerChanges(req, update, counter());
  if (result.kind !== 'changes') throw new Error(`Expected changes, got ${JSON.stringify(result)}`);
  return result.theirs;
}

/** Applies `update` to the CV the job started from (`req.cv`), then meets it with `current`. */
function resolve(req: AnswerRequest, update: AnswerUpdate, current: CvContent) {
  return resolveAnswer(req.cv, applyAnswerChanges(req, update, counter()), current);
}

const role = (changes: Partial<RoleChanges> = {}): RoleChanges => ({
  id: '',
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  current: 'keep',
  editBullets: [],
  addBullets: [],
  ...changes,
});

const school = (changes: Partial<EducationChanges> = {}): EducationChanges => ({
  id: '',
  degree: '',
  school: '',
  location: '',
  start: '',
  end: '',
  details: '',
  ...changes,
});

const contact = (changes: Partial<ContactChanges> = {}): ContactChanges => ({
  firstName: '',
  lastName: '',
  headline: '',
  email: '',
  phone: '',
  location: '',
  workSetup: '',
  addLinks: [],
  ...changes,
});

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('applyAnswerChanges', () => {
  describe('a request for more detail', () => {
    it('wins over any change on the first round', () => {
      const result = applyAnswerChanges(
        request('summary'),
        { followUp: '  Which team did you lead?  ', summary: 'Leads the payments team.' },
        counter(),
      );

      expect(result).toEqual({ kind: 'follow_up', followUp: 'Which team did you lead?' });
    });

    it('is ignored once the AI has asked, and the changes apply', () => {
      const theirs = changed(request('summary', { followUp: 'Which team did you lead?' }), {
        followUp: 'How big is the team?',
        summary: 'Leads the payments team.',
      });

      expect(theirs).toEqual(edited((cv) => void (cv.summary = 'Leads the payments team.')));
    });

    it('counts as none when it is blank', () => {
      const theirs = changed(request('summary'), {
        followUp: '   ',
        summary: 'Leads the payments team.',
      });

      expect(theirs.summary).toBe('Leads the payments team.');
    });

    it('changes nothing on the second round when the AI still has nothing to apply', () => {
      const req = request('summary', { followUp: 'Which team did you lead?' });
      const changes = applyAnswerChanges(
        req,
        { followUp: 'Which team, exactly?', summary: '' },
        counter(),
      );

      expect(changes).toEqual({ kind: 'changes', theirs: CV });
      expect(resolveAnswer(CV, changes, CV)).toEqual({ kind: 'content', content: CV, applied: [] });
    });
  });

  describe('fields', () => {
    it('keeps a field left empty, and trims what the AI wrote', () => {
      const theirs = changed(request('experience', { itemId: 'e1' }), {
        followUp: '',
        experience: [
          role({ id: 'e1', title: '  Senior Backend Engineer  ', location: '   ', start: '' }),
        ],
      });

      expect(theirs.experience[0]).toEqual({
        ...CV.experience[0],
        title: 'Senior Backend Engineer',
      });
    });

    it('trims contact details, and keeps those left empty', () => {
      const theirs = changed(request('contact'), {
        followUp: '',
        contact: contact({ location: ' Porto ', workSetup: '\tOpen to remote roles\n' }),
      });

      expect(theirs.contact).toEqual({
        ...CV.contact,
        location: 'Porto',
        workSetup: 'Open to remote roles',
      });
    });

    it('never empties or deletes anything', () => {
      const req = request('general');

      expect(changed(req, { followUp: '', summary: '   ', addSkills: ['', '  '] })).toEqual(CV);
      expect(
        changed(request('education', { itemId: 'ed1' }), {
          followUp: '',
          education: [school({ id: 'ed1' })],
        }),
      ).toEqual(CV);
      expect(
        changed(request('contact'), { followUp: '', contact: contact({ addLinks: [] }) }),
      ).toEqual(CV);
    });
  });

  describe('scope', () => {
    it('changes only the entry a question is about', () => {
      const theirs = changed(request('experience', { itemId: 'e1' }), {
        followUp: '',
        experience: [
          role({ id: 'e2', title: 'Senior Engineer' }),
          role({ id: 'e1', location: 'Lisbon · Remote' }),
          role({ id: 'e9', title: 'Invented role' }),
        ],
      });

      expect(theirs).toEqual(
        edited((cv) => {
          cv.experience[0]!.location = 'Lisbon · Remote';
        }),
      );
    });

    it('applies changes without an id to the entry a question is about, and adds none', () => {
      const experience = changed(request('experience', { itemId: 'e2' }), {
        followUp: '',
        experience: [role({ title: 'Software Engineer', addBullets: ['Built the checkout.'] })],
      });
      const education = changed(request('education', { itemId: 'ed1' }), {
        followUp: '',
        education: [school({ details: 'Thesis on payment fraud.' })],
      });

      expect(ids(experience.experience)).toEqual(['e1', 'e2']);
      expect(experience.experience[1]).toMatchObject({
        title: 'Software Engineer',
        bullets: [{ id: 'new-1', text: 'Built the checkout.' }],
      });
      expect(education.education).toEqual([
        { ...CV.education[0], details: 'Thesis on payment fraud.' },
      ]);
    });

    it('takes the change that names the entry, not another one the answer describes', () => {
      // "March 2021. Before that I was an engineer at Acme, 2019–2021."
      const theirs = changed(request('experience', { itemId: 'e1' }), {
        followUp: '',
        experience: [
          role({ id: 'e1', start: 'Mar 2021' }),
          role({ title: 'Engineer', company: 'Acme', start: '2019', end: '2021' }),
        ],
      });

      expect(theirs).toEqual(edited((cv) => void (cv.experience[0]!.start = 'Mar 2021')));
    });

    it('applies nothing when several changes without an id could be the entry', () => {
      const experience = changed(request('experience', { itemId: 'e1' }), {
        followUp: '',
        experience: [
          role({ company: 'Acme', start: '2019' }),
          role({ company: 'Shopwise', start: '2016' }),
        ],
      });
      const education = changed(request('education', { itemId: 'ed1' }), {
        followUp: '',
        education: [
          school({ details: 'Thesis on payment fraud.' }),
          school({ degree: 'MSc Data Science', school: 'Nova SBE' }),
        ],
      });

      expect(experience).toEqual(CV);
      expect(education).toEqual(CV);
    });

    it('adds every new entry when a question is about the whole section', () => {
      const theirs = changed(request('experience'), {
        followUp: '',
        experience: [
          role({ title: 'Engineer', company: 'Acme', start: '2019' }),
          role({ title: 'Intern', company: 'Shopwise', start: '2016' }),
        ],
      });

      expect(ids(theirs.experience)).toEqual(['e1', 'e2', 'new-1', 'new-2']);
    });

    it('adds an entry without an id when a question is about no entry in particular', () => {
      const theirs = changed(request('experience'), {
        followUp: '',
        experience: [
          role({
            title: ' Staff Engineer ',
            company: 'Ledgerly',
            start: '2024',
            addBullets: ['Built the ledger.'],
          }),
        ],
      });

      expect(theirs.experience).toEqual([
        ...CV.experience,
        {
          id: 'new-1',
          title: 'Staff Engineer',
          company: 'Ledgerly',
          location: '',
          start: '2024',
          end: '',
          current: false,
          bullets: [{ id: 'new-2', text: 'Built the ledger.' }],
        },
      ]);

      const education = changed(request('education'), {
        followUp: '',
        education: [school({ degree: 'MSc Data Science', school: 'IST', end: '2020' })],
      });
      expect(education.education).toEqual([
        ...CV.education,
        {
          id: 'new-1',
          degree: 'MSc Data Science',
          school: 'IST',
          location: '',
          start: '',
          end: '2020',
          details: '',
        },
      ]);
    });

    it('adds a role with a title or a company, and a school with a degree or a school', () => {
      const experience = changed(request('experience'), {
        followUp: '',
        experience: [
          role({ title: 'Consultant' }),
          role({ company: 'Freelance' }),
          role({ location: 'Porto', start: '2015', addBullets: ['Did things.'] }),
        ],
      });
      const education = changed(request('education'), {
        followUp: '',
        education: [
          school({ degree: 'AWS Solutions Architect' }),
          school({ school: 'Le Wagon' }),
          school({ details: 'Honours', end: '2012' }),
        ],
      });

      expect(experience.experience.slice(2)).toMatchObject([
        { title: 'Consultant', company: '' },
        { title: '', company: 'Freelance' },
      ]);
      expect(education.education.slice(1)).toMatchObject([
        { degree: 'AWS Solutions Architect', school: '' },
        { degree: '', school: 'Le Wagon' },
      ]);
    });

    it('ignores changes to entries the CV doesn’t have', () => {
      expect(
        changed(request('experience'), {
          followUp: '',
          experience: [role({ id: 'e9', title: 'Invented role', addBullets: ['Invented.'] })],
        }),
      ).toEqual(CV);
      expect(
        changed(request('education'), {
          followUp: '',
          education: [school({ id: 'ed9', degree: 'Invented degree' })],
        }),
      ).toEqual(CV);
    });
  });

  describe('roles', () => {
    const changedRole = (id: string, changes: Partial<RoleChanges>) =>
      changed(request('experience', { itemId: id }), {
        followUp: '',
        experience: [role({ id, ...changes })],
      }).experience.find((entry) => entry.id === id);

    it('marks a role as ongoing, clearing its end date', () => {
      expect(changedRole('e2', { current: 'yes', end: 'Jun 2022' })).toMatchObject({
        current: true,
        end: '',
      });
    });

    it('marks a role as ended', () => {
      expect(changedRole('e1', { current: 'no', end: 'Mar 2024' })).toMatchObject({
        current: false,
        end: 'Mar 2024',
      });
      expect(changedRole('e1', { current: 'no' })).toMatchObject({ current: false, end: '' });
    });

    it('leaves whether a role is ongoing as it is on “keep”', () => {
      expect(changedRole('e1', { current: 'keep' })).toEqual(CV.experience[0]);
      expect(changedRole('e2', { current: 'keep' })).toEqual(CV.experience[1]);
    });

    it('rewrites bullets by id, ignoring empty rewrites and bullets the role doesn’t have', () => {
      expect(
        changedRole('e1', {
          editBullets: [
            { id: ' b1 ', text: '  Led the payments API, serving 2M requests a day. ' },
            { id: 'b2', text: '   ' },
            { id: 'b9', text: 'Invented.' },
          ],
        })?.bullets,
      ).toEqual([
        { id: 'b1', text: 'Led the payments API, serving 2M requests a day.' },
        { id: 'b2', text: 'Moved billing to Kafka.' },
      ]);
    });

    it('adds only bullets the role doesn’t have yet, ignoring case', () => {
      expect(
        changedRole('e1', {
          editBullets: [{ id: 'b2', text: 'Moved billing to Kafka in six weeks.' }],
          addBullets: [
            'led the payments API.',
            'Moved billing to Kafka in six weeks.',
            ' Mentored two engineers. ',
            'MENTORED TWO ENGINEERS.',
            '  ',
          ],
        })?.bullets,
      ).toEqual([
        { id: 'b1', text: 'Led the payments API.' },
        { id: 'b2', text: 'Moved billing to Kafka in six weeks.' },
        { id: 'new-1', text: 'Mentored two engineers.' },
      ]);
    });
  });

  describe('skills', () => {
    it('adds skills the CV doesn’t list yet, once each and ignoring case', () => {
      const theirs = changed(request('skills'), {
        followUp: '',
        addSkills: [' Rust ', 'go', 'rust', 'KAFKA', 'Terraform', ''],
      });

      expect(theirs.skills).toEqual([
        ...CV.skills,
        { id: 'new-1', name: 'Rust' },
        { id: 'new-2', name: 'Terraform' },
      ]);
    });

    it('applies a general answer to the summary and the skills only', () => {
      const theirs = changed(request('general'), {
        followUp: '',
        summary: ' Builds payment systems used by 3M people. ',
        addSkills: ['PostgreSQL'],
      });

      expect(theirs).toEqual(
        edited((cv) => {
          cv.summary = 'Builds payment systems used by 3M people.';
          cv.skills.push({ id: 'new-1', name: 'PostgreSQL' });
        }),
      );
    });
  });

  describe('contact details', () => {
    it('takes those the answer spells out, however the AI tidied them up', () => {
      const req = request('contact', {
        answer:
          'Email Alex.Morgan@Gmail.com, call (+351) 912-345-678, or see www.LinkedIn.com/in/alexmorgan/',
      });

      const theirs = changed(req, {
        followUp: '',
        contact: contact({
          email: 'alex.morgan@gmail.com',
          phone: '+351 912 345 678',
          addLinks: [{ label: 'LinkedIn', url: 'https://linkedin.com/in/alexmorgan' }],
        }),
      });

      expect(theirs.contact).toEqual({
        ...CV.contact,
        email: 'alex.morgan@gmail.com',
        phone: '+351 912 345 678',
        links: [
          ...CV.contact.links,
          { id: 'new-1', label: 'LinkedIn', url: 'https://linkedin.com/in/alexmorgan' },
        ],
      });
    });

    it.each([
      ['email', contact({ email: 'alex.morgan@gmail.com' })],
      ['phone', contact({ phone: '+44 20 7946 0958' })],
      ['links', contact({ addLinks: [{ label: 'Portfolio', url: 'alexmorgan.dev' }] })],
    ] as const)('asks for the %s when the answer doesn’t spell it out', (field, changes) => {
      const answer = 'My Gmail, my UK number and my portfolio site.';

      for (const followUp of [null, 'Which address?']) {
        expect(
          applyAnswerChanges(
            request('contact', { answer, followUp }),
            { followUp: '', contact: changes },
            counter(),
          ),
        ).toEqual({ kind: 'follow_up', followUp: CONTACT_FOLLOW_UPS[field] });
      }
    });

    it('asks for the email first, then the phone', () => {
      const changes = contact({
        email: 'alex.morgan@gmail.com',
        phone: '+44 20 7946 0958',
        addLinks: [{ label: 'Portfolio', url: 'alexmorgan.dev' }],
      });
      const ask = (answer: string) =>
        applyAnswerChanges(
          request('contact', { answer }),
          { followUp: '', contact: changes },
          counter(),
        );

      expect(ask('Nothing useful.')).toMatchObject({ followUp: CONTACT_FOLLOW_UPS.email });
      expect(ask('alex.morgan@gmail.com')).toMatchObject({ followUp: CONTACT_FOLLOW_UPS.phone });
      expect(ask('alex.morgan@gmail.com, +44 20 7946 0958')).toMatchObject({
        followUp: CONTACT_FOLLOW_UPS.links,
      });
    });

    it('asks for the email when it isn’t a full address, even though the answer has it', () => {
      const result = applyAnswerChanges(
        request('contact', { answer: 'It’s max@gmail' }),
        { followUp: '', contact: contact({ email: 'max@gmail' }) },
        counter(),
      );

      expect(result).toEqual({ kind: 'follow_up', followUp: CONTACT_FOLLOW_UPS.email });
    });

    it('takes a detail from the answer before a follow-up, which Claude saw too', () => {
      const exchange: AnswerRequest = {
        ...request('contact', { answer: 'Yes, that one.', followUp: 'Which email should I use?' }),
        previousAnswer: 'Use alex.morgan@northpay.com',
      };

      const theirs = changed(exchange, {
        followUp: '',
        contact: contact({ email: 'alex.morgan@northpay.com' }),
      });

      expect(theirs.contact.email).toBe('alex.morgan@northpay.com');
    });

    it('doesn’t check an email or a phone the CV already has', () => {
      const cv = edited((draft) => void (draft.contact.phone = '+351 912 345 678'));

      const theirs = changed(request('contact', { answer: 'I’d like remote work.', cv }), {
        followUp: '',
        contact: contact({
          email: ' alex@example.com ',
          phone: '+351 912 345 678',
          workSetup: 'Open to remote roles',
        }),
      });

      expect(theirs).toEqual(
        edited((draft) => void (draft.contact.workSetup = 'Open to remote roles'), cv),
      );
    });

    it('doesn’t take an email or a phone the CV has, repeated in another form, for a new one', () => {
      const cv = edited((draft) => void (draft.contact.phone = '+351 912 345 678'));

      const result = applyAnswerChanges(
        request('contact', { answer: 'I’m based in Porto now.', cv }),
        {
          followUp: '',
          contact: contact({
            email: 'ALEX@example.com',
            phone: '+351912345678',
            location: 'Porto',
          }),
        },
        counter(),
      );

      // Only the location changes, and the stored email and phone keep their form.
      expect(result).toEqual({
        kind: 'changes',
        theirs: edited((draft) => void (draft.contact.location = 'Porto'), cv),
      });
    });

    it('doesn’t add a link the CV already has, however it is written', () => {
      const theirs = changed(request('contact', { answer: 'It’s on my CV already.' }), {
        followUp: '',
        contact: contact({ addLinks: [{ label: 'GitHub', url: 'WWW.GitHub.com/alexmorgan/' }] }),
      });

      expect(theirs).toEqual(CV);
    });

    it('labels a link without a label “Website”, and adds each address once', () => {
      const theirs = changed(request('contact', { answer: 'alexmorgan.dev' }), {
        followUp: '',
        contact: contact({
          addLinks: [
            { label: '', url: ' alexmorgan.dev ' },
            { label: 'Portfolio', url: 'https://alexmorgan.dev/' },
            { label: 'Empty', url: '  ' },
          ],
        }),
      });

      expect(theirs.contact.links).toEqual([
        ...CV.contact.links,
        { id: 'new-1', label: 'Website', url: 'alexmorgan.dev' },
      ]);
    });
  });
});

describe('resolveAnswer', () => {
  it('passes a request for more detail through', () => {
    expect(resolveAnswer(CV, { kind: 'follow_up', followUp: 'Which team?' }, CV)).toEqual({
      kind: 'follow_up',
      followUp: 'Which team?',
    });
  });

  it('lists what changed against the CV as it is now', () => {
    const req = request('contact', { answer: 'alex.morgan@gmail.com and alexmorgan.dev' });
    // Edited by hand while the AI worked: already in the CV, so not part of what the answer applied.
    const current = edited((cv) => void (cv.summary = 'Builds payment systems at scale.'));

    const result = resolve(
      req,
      {
        followUp: '',
        contact: contact({
          email: 'alex.morgan@gmail.com',
          addLinks: [{ label: 'Portfolio', url: 'alexmorgan.dev' }],
        }),
      },
      current,
    );

    expect(result).toEqual({
      kind: 'content',
      content: edited((cv) => {
        cv.contact.email = 'alex.morgan@gmail.com';
        cv.contact.links.push({ id: 'new-1', label: 'Portfolio', url: 'alexmorgan.dev' });
      }, current),
      applied: ['contact.email', 'contact.links.new-1'],
    });
  });

  it('keeps a field the person changed meanwhile, and lands the AI’s other changes', () => {
    const current = edited((cv) => {
      cv.experience[0]!.title = 'Lead Engineer';
      cv.contact.email = 'alex@northpay.com';
      cv.summary = 'Written by hand.';
    });

    const experience = resolve(
      request('experience', { itemId: 'e1' }),
      {
        followUp: '',
        experience: [
          role({ id: 'e1', title: 'Senior Backend Engineer', location: 'Lisbon · Remote' }),
        ],
      },
      current,
    );
    const contactDetails = resolve(
      request('contact', { answer: 'alex.morgan@gmail.com; open to remote roles' }),
      {
        followUp: '',
        contact: contact({ email: 'alex.morgan@gmail.com', workSetup: 'Open to remote roles' }),
      },
      current,
    );
    const general = resolve(
      request('general'),
      { followUp: '', summary: 'Written by the AI.', addSkills: ['Rust'] },
      current,
    );

    expect(experience).toEqual({
      kind: 'content',
      content: edited((cv) => void (cv.experience[0]!.location = 'Lisbon · Remote'), current),
      applied: ['experience.e1.location'],
    });
    expect(contactDetails).toEqual({
      kind: 'content',
      content: edited((cv) => void (cv.contact.workSetup = 'Open to remote roles'), current),
      applied: ['contact.workSetup'],
    });
    expect(general).toEqual({
      kind: 'content',
      content: edited((cv) => void cv.skills.push({ id: 'new-1', name: 'Rust' }), current),
      applied: ['skills.new-1'],
    });
  });

  it('keeps an entry the person deleted meanwhile deleted, changing nothing', () => {
    const req = request('experience', { itemId: 'e1' });
    const update: AnswerUpdate = {
      followUp: '',
      experience: [
        role({
          id: 'e1',
          location: 'Lisbon · Remote',
          editBullets: [{ id: 'b1', text: 'Led the payments API, serving 2M requests a day.' }],
          addBullets: ['Mentored two engineers.'],
        }),
      ],
    };
    const roleDeleted = edited((cv) => void cv.experience.splice(0, 1));
    const bulletDeleted = edited((cv) => void cv.experience[0]!.bullets.splice(0, 1));

    expect(resolve(req, update, roleDeleted)).toEqual({
      kind: 'content',
      content: roleDeleted,
      applied: [],
    });
    // The rewrite of the deleted bullet is dropped; the rest of the answer still lands.
    expect(resolve(req, update, bulletDeleted)).toMatchObject({
      kind: 'content',
      content: {
        experience: [
          {
            location: 'Lisbon · Remote',
            bullets: [
              { id: 'b2', text: 'Moved billing to Kafka.' },
              { id: 'new-1', text: 'Mentored two engineers.' },
            ],
          },
          CV.experience[1],
        ],
      },
      applied: ['experience.e1.location', 'experience.e1.bullets.new-1'],
    });
  });

  it('doesn’t bring back a skill or a bullet the person deleted meanwhile', () => {
    const current = edited((cv) => {
      cv.skills.splice(1, 1); // Kafka
      cv.experience[0]!.bullets.splice(1, 1); // Moved billing to Kafka.
    });

    expect(resolve(request('skills'), { followUp: '', addSkills: ['kafka'] }, current)).toEqual({
      kind: 'content',
      content: current,
      applied: [],
    });
    expect(
      resolve(
        request('experience', { itemId: 'e1' }),
        { followUp: '', experience: [role({ addBullets: ['Moved billing to Kafka.'] })] },
        current,
      ),
    ).toEqual({ kind: 'content', content: current, applied: [] });
  });

  describe('leaves out what the person added meanwhile', () => {
    it('a skill, ignoring case', () => {
      const current = edited((cv) => void cv.skills.push({ id: 'mine', name: 'rust' }));

      const result = resolve(
        request('skills'),
        { followUp: '', addSkills: ['Rust', 'Terraform'] },
        current,
      );

      expect(result).toMatchObject({ kind: 'content', applied: ['skills.new-2'] });
      if (result.kind !== 'content') return;
      expect(result.content.skills).toEqual([
        ...CV.skills,
        { id: 'new-2', name: 'Terraform' },
        { id: 'mine', name: 'rust' },
      ]);
    });

    it('a link, however it is written', () => {
      const current = edited(
        (cv) =>
          void cv.contact.links.push({ id: 'mine', label: 'Site', url: 'https://alexmorgan.dev' }),
      );

      expect(
        resolve(
          request('contact', { answer: 'Portfolio: www.alexmorgan.dev/' }),
          {
            followUp: '',
            contact: contact({ addLinks: [{ label: 'Portfolio', url: 'www.alexmorgan.dev/' }] }),
          },
          current,
        ),
      ).toEqual({ kind: 'content', content: current, applied: [] });
    });

    it('a bullet, ignoring case', () => {
      const current = edited(
        (cv) =>
          void cv.experience[0]!.bullets.push({ id: 'mine', text: 'Mentored two engineers.' }),
      );

      expect(
        resolve(
          request('experience', { itemId: 'e1' }),
          {
            followUp: '',
            experience: [role({ id: 'e1', addBullets: ['mentored two engineers.'] })],
          },
          current,
        ),
      ).toEqual({ kind: 'content', content: current, applied: [] });
    });
  });

  describe('leaves out additions over a list’s limit, keeping every entry the CV has', () => {
    it('bullets', () => {
      const bullets = (count: number) =>
        Array.from({ length: count }, (_, index) => ({
          id: `b${index + 1}`,
          text: `Shipped feature ${index + 1}.`,
        }));
      const base = edited((cv) => void (cv.experience[0]!.bullets = bullets(13)));
      // The person filled the role up to 15 bullets while the AI worked.
      const current = edited(
        (cv) =>
          void cv.experience[0]!.bullets.push(
            { id: 'mine-1', text: 'Mentored two engineers.' },
            { id: 'mine-2', text: 'Cut costs by a third.' },
          ),
        base,
      );

      expect(
        resolve(
          request('experience', { itemId: 'e1', cv: base }),
          {
            followUp: '',
            experience: [role({ id: 'e1', addBullets: ['Ran the on-call rota.'] })],
          },
          current,
        ),
      ).toEqual({ kind: 'content', content: current, applied: [] });
    });

    it('skills, keeping the first that fit', () => {
      const base = edited(
        (cv) =>
          void (cv.skills = Array.from({ length: 79 }, (_, index) => ({
            id: `s${index + 1}`,
            name: `Skill ${index + 1}`,
          }))),
      );

      const result = resolve(
        request('skills', { cv: base }),
        { followUp: '', addSkills: ['Rust', 'Terraform', 'Kubernetes'] },
        base,
      );

      expect(result).toMatchObject({ kind: 'content', applied: ['skills.new-1'] });
      if (result.kind !== 'content') return;
      expect(result.content.skills).toHaveLength(80);
      expect(result.content.skills.at(-1)).toEqual({ id: 'new-1', name: 'Rust' });
    });

    it('roles', () => {
      const base = edited(
        (cv) =>
          void (cv.experience = Array.from({ length: 30 }, (_, index) => ({
            ...CV.experience[1]!,
            id: `r${index + 1}`,
          }))),
      );

      expect(
        resolve(
          request('experience', { cv: base }),
          { followUp: '', experience: [role({ title: 'Staff Engineer', company: 'Ledgerly' })] },
          base,
        ),
      ).toEqual({ kind: 'content', content: base, applied: [] });
    });
  });

  it('reports changes that break the CV’s rules as invalid, so nothing is written', () => {
    // The answer's schema takes any text; the CV's refuses U+0000, which JSONB can't store.
    const result = resolve(
      request('summary'),
      { followUp: '', summary: 'Builds payment systems.\u0000' },
      CV,
    );

    expect(result).toEqual({ kind: 'invalid' });
  });
});
