// The in-app guide (24 Nov): opens in its own browser tab from Help, below Settings. A menu on the left, the guide on the right, and a
// search box. KEEP IT CURRENT: whenever a feature is added or changed, update its section here (and the date below).
import { useMemo, useState, type ReactNode } from 'react'

const UPDATED = '24 November 2026'

interface Section {
  id: string
  title: string
  group: string
  body: ReactNode
}

const SECTIONS: Section[] = [
  {
    id: 'start',
    group: 'Getting started',
    title: 'Finding your way around',
    body: (
      <>
        <p>The menu down the left (or the ☰ button on a phone) takes you to each area: Home, Tasks, Dashboard, Jobs, Estimating, Contracts, Site, Supply Chain and, for admins, Settings. Each job has its own tabs along the top: everything about that job lives inside it.</p>
        <p>
          An area with a padlock is greyed out because you do not have access yet. Open it and press <b>Request access</b>: the request goes to IT. Which areas each type of person can open is set in Settings › Access.
        </p>
        <p>The bell at the top shows what needs you: actions, reminders, RFIs, inspections falling due. Tick one done and it clears. If emails are switched on you also get the important ones by email.</p>
        <p>Working on site with a poor signal: the app keeps a saved copy and syncs when the connection returns. A grey “Offline” bar tells you when that is happening.</p>
      </>
    ),
  },
  {
    id: 'keys',
    group: 'Getting started',
    title: 'Keyboard shortcuts in every form',
    body: (
      <>
        <ul>
          <li>
            <b>Tab</b> moves to the next field, including past a date box.
          </li>
          <li>Click anywhere in a date box to open the calendar, or just start typing the date.</li>
          <li>
            <b>Enter</b> on a drop-down opens it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'tasks',
    group: 'Day to day',
    title: 'Home and Tasks',
    body: (
      <>
        <p>
          <b>Home</b> is your starting page. <b>Tasks</b> is your own list: your actions from meeting minutes (across every job), and tasks given to you. Tick one off when it is done. Each job’s Overview also shows that job’s To do list for everyone.
        </p>
      </>
    ),
  },
  {
    id: 'jobs',
    group: 'Jobs',
    title: 'A job and its tabs',
    body: (
      <>
        <p>
          Open <b>Jobs</b>, then a job. The tabs along the top hold that job’s modules: Overview (with the project checklist), Progress reports, Programme, Minutes, RFIs, Submittals, Snagging, H&S, BREEAM, Variations, Quotations, Applications, Orders, Cashflow, Procurement, Sampling, EOT, CVR and O&amp;M. You only see the tabs you have access to; the others are greyed.
        </p>
        <p>
          <b>Project hub link:</b> in Edit job, paste the job’s one SharePoint link. It is then added to the foot of issued minutes, snag lists, every email to outside people and the outside pages, so everyone can find the drawings and documents. Document Control manage the folders inside it.
        </p>
        <p>An archived job is read-only everywhere. An admin can unarchive it.</p>
      </>
    ),
  },
  {
    id: 'minutes',
    group: 'Jobs',
    title: 'Meeting minutes',
    body: (
      <>
        <p>
          Open a job’s <b>Minutes</b> tab. Type a point and press <b>Enter</b> to start the next one (Shift+Enter for a new line, Esc to undo). It saves as you go, and keeps a copy on your device if the signal drops.
        </p>
        <h4>Typing shortcuts</h4>
        <ul>
          <li>
            <b>@</b> then initials or a name mentions an attendee (Enter or Tab picks the first).
          </li>
          <li>
            <b>#</b> at the start makes a heading; <b>!</b> makes it urgent; <b>£</b> flags a cost impact (shown in the app only, never in exports or emails).
          </li>
          <li>
            <b>/</b> links the point to an RFI, submittal, snag or variation. Type <b>/</b> then a few letters (<b>/rfi 12</b>, <b>/door</b>): pick with the arrow keys and Enter. Or simply type “RFI 12” or “Snag 4” in the text and it links itself when you move on. Linked items show under the point as chips you can click, with their status.
          </li>
        </ul>
        <h4>Actions</h4>
        <p>
          Switch on <b>Action item</b> on a point, choose the owner (an attendee) and a due date. Staff owners get it on their bell and in Tasks. Press <b>Complete</b> when it is done. <b>+ Add update</b> keeps a running log that travels with it to the next meeting.
        </p>
        <h4>Meeting type and standing agenda</h4>
        <p>Pick a meeting type (progress, design team, pre-start, H&amp;S, tender) beside the date and its usual headings are loaded. The next meeting of that type starts with them again, after the actions carried forward.</p>
        <h4>Attendees</h4>
        <p>
          Add people one at a time, or press <b>+ Add the whole project team</b> to bring in the job’s team and everyone in the project directory. Click the tick beside a name to change it: <b>in attendance → apologies → referenced only</b>.
        </p>
        <h4>Numbers</h4>
        <p>Meetings are numbered per job (Meeting 12). Headings are 1, 2, 3 and points 1.1, 1.2…, so people can say “see 12/4.3” in an email or RFI. Numbers follow the order of the points; an issued copy keeps its numbers.</p>
        <h4>Draft from notes</h4>
        <p>
          <b>Draft from notes</b> (top bar): paste rough notes or a Teams or Zoom transcript. The app drafts headings, points and actions with owners and dates. Untick anything you do not want, add the rest, and edit as normal. Add the attendees first so actions get the right owners. Always check the owners and dates.
        </p>
        <h4>Issuing the minutes</h4>
        <p>
          <b>Email → Issue / email the minutes (PDF)…</b> shows who it goes to (tick all, some, or whole groups such as every subcontractor). Leave <b>Issue as Rev A</b> ticked to record the revision, keep a copy of exactly what was sent, lock the minutes and email outside owners their own actions. To change them afterwards press <b>Amend</b>: the next issue is Rev B. <b>Issue history</b> shows who got what and when, with a PDF of each issue. Untick the box to email a draft without issuing.
        </p>
        <h4>Exports and Next meeting</h4>
        <p>Export as PDF or Word in the same design as the progress report. <b>Next meeting</b> at the foot starts a follow-up and carries every open action forward.</p>
        <h4>Chasing</h4>
        <p>Actions with a due date are chased automatically: a reminder two days before, then every week while overdue, until someone ticks it done. Staff get it on the bell and by email; outside owners get an email with their own link.</p>
      </>
    ),
  },
  {
    id: 'rfis',
    group: 'Jobs',
    title: 'RFIs and submittals',
    body: (
      <>
        <p>
          Add the people involved to the job’s <b>project directory</b> first. In <b>RFIs</b>, raise a question, choose who has to answer and who is copied, and set a date required. In <b>Submittals</b>, send documents for review; each document gets a status A (approved), B (approved with comments) or C (revise and resubmit).
        </p>
        <p>The app emails outside people with their own private link: no account or password. It chases automatically as the date approaches and passes, and shows you whose turn it is. DBP closes an RFI when it is resolved.</p>
      </>
    ),
  },
  {
    id: 'outside',
    group: 'Outside people',
    title: 'What outside people see',
    body: (
      <>
        <p>
          Subcontractors, consultants and clients never log in. They use the link in an email, or go to <b>/external</b> and enter their email address to get a 6-digit code. They see only what is addressed to them, in four lists: <b>RFIs</b>, <b>Submittals</b>, <b>Snags</b> and <b>Actions from meetings</b>, each split by project. Rows turn amber when the date is near and red when it has passed.
        </p>
        <p>
          <b>Actions from meetings:</b> anyone added to the minutes with their email address sees the actions they own. They open one, add a note, and press <b>Mark as done</b>. The minutes update on the spot (with a note of who ticked it off), and the person who ran the meeting gets a message on the bell. They can re-open one they ticked by mistake.
        </p>
        <p>The project hub link appears at the bottom of every outside page and email. Anyone added to a job’s directory gets an automatic welcome email with that link.</p>
      </>
    ),
  },
  {
    id: 'snagging',
    group: 'Jobs',
    title: 'Snagging',
    body: (
      <>
        <p>
          In <b>Snagging</b> raise snags (with photos), give each to a company, and send them the link. They tick a snag done on their phone, optionally with a photo as proof; once one person from the company has ticked it, it shows done for everyone there. You check it: <b>Complete</b>, or <b>Not done / not good enough: send back</b> with a reason, and it returns to their list.
        </p>
      </>
    ),
  },
  {
    id: 'hs',
    group: 'Jobs',
    title: 'Health and safety',
    body: (
      <>
        <ul>
          <li>
            <b>Site diaries:</b> a daily record (weather, labour, works, visitors, delays, photos). Export to Excel.
          </li>
          <li>
            <b>Delivery notes:</b> what arrived, when and who checked it, with a photo of the note.
          </li>
          <li>
            <b>Inspections:</b> a log of the external H&amp;S inspections. Enter the date, the inspector and attach the report. The app files it in the job’s SharePoint H&amp;S folder (link the folder once on each computer, using Edge or Chrome) and works out when the next is due. Set how often and who is reminded; the PM is reminded beforehand and chased weekly while it is overdue.
          </li>
          <li>
            <b>Accident reports:</b> the standard accident form, numbered, with RIDDOR and corrective actions.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'progress',
    group: 'Jobs',
    title: 'Progress reports, programme and checklist',
    body: (
      <>
        <p>
          <b>Progress reports</b> build the monthly report as a PDF from the job’s information, and remind the PM when one is due. <b>Programme</b> imports the programme and shows the timeline. The <b>project checklist</b> on the Overview lists the set-up jobs for a new project: tick them off as you go.
        </p>
      </>
    ),
  },
  {
    id: 'commercial',
    group: 'Commercial',
    title: 'Estimating, contracts, variations and orders',
    body: (
      <>
        <p>
          <b>Estimating</b> holds enquiries and quotations, including the tender enquiry generator, and tender meeting minutes. A won enquiry is set up as a job and its meetings move across. In a job, <b>Variations</b>, <b>Quotations</b>, <b>Applications</b>, <b>Orders</b>, <b>Cashflow</b>, <b>CVR</b> and <b>EOT</b> cover the money side. <b>Contracts</b> is the company-wide view.
        </p>
        <p>
          <b>Applications:</b> press <b>+ New application</b> and a small panel asks two things. Tick <b>Practical completion has been achieved</b> to halve the retention on that application and every later one (confetti when you tick it). Tick <b>This is the final account</b> when the application is the last one: the list then shows a “Final account” tag and a note that the project is finished off. Both can also be changed inside an application.
        </p>
        <p>
          <b>Orders:</b> the list shows, for each order, its value (including instructed variations), how it stands against the package budget in the procurement schedule (“over” in red, “under” in green), what DBP has certified so far and what has been paid, with a total underneath. Use the buttons (All, Drafts, Placed, Over budget) and the search box to narrow it. Open an order and <b>The money</b> panel gives the full picture: budget, order value, variations, revised value, certified to date, retention held, paid and still to certify. These come from the issued payment notices.
        </p>
        <p>
          The order itself, and the instruction letter for a subcontract variation, always go out as a <b>PDF</b> on the DBP letterhead, never Word (the <b>Order (PDF)</b> button, the email attachment and the copy saved to the SharePoint folder are all PDFs).
        </p>
        <p>
          When you press <b>Place order</b> (or make the email for a draft), the app checks first: a PQQ that isn’t approved or has run out, insurance or other documents that have expired, no value, a value over the package budget, or a package that already has a placed order. Anything serious is listed in amber and you must tick “I’ve seen the warnings” to carry on; smaller points (no delivery date, blank scope, things expiring soon) are shown for information. If everything is fine you just press Place order.
        </p>
      </>
    ),
  },
  {
    id: 'site',
    group: 'Day to day',
    title: 'Site, requisitions and the supply chain',
    body: (
      <>
        <p>
          <b>Site</b> is for site management and the buyer: requisitions, plant off-hire reminders and ordering. <b>Supply Chain</b> holds companies and contacts, their pre-qualification and document expiry, which chase themselves.
        </p>
      </>
    ),
  },
  {
    id: 'settings',
    group: 'Admin',
    title: 'Settings (admins)',
    body: (
      <>
        <ul>
          <li>
            <b>Access:</b> tick which parts of the app each type of person can open, including each job tab.
          </li>
          <li>
            <b>Usage:</b> which areas and people use the app most, by day. It records pages visited only, never what is typed.
          </li>
          <li>People and their profile types are managed here too.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'extras',
    group: 'Day to day',
    title: 'Monday briefing and little celebrations',
    body: (
      <>
        <p>
          <b>Monday briefing:</b> every Monday morning, from 6:30am, you get one friendly email with your week: what is overdue, what is due in the next 7 days, how many meeting actions you closed last week, and a button to open your tasks. It is built from the same list as your bell. Switch it off with <b>email notifications</b> in My details.
        </p>
        <p>
          <b>Milestone moments:</b> confetti and a banner when you clear the last snag on a job, tick off the last action of a meeting, or empty your My Day list. Nothing animates if your device is set to reduced motion.
        </p>
        <p>
          <b>Loading lines:</b> while a page loads you will see a line of site humour instead of plain “Loading…”.
        </p>
      </>
    ),
  },
  {
    id: 'email',
    group: 'Admin',
    title: 'Emails and reminders',
    body: (
      <>
        <p>The app sends email from the DBP mailbox: new RFIs and chases, welcome emails, issued minutes, actions due and overdue, inspections due, reports due, and the Monday briefing. Everyone can switch their own emails off in My details. Reminders only run once IT has set up the mailbox and the scheduled job for the app.</p>
        <p>
          <b>The du Boulay email signature</b> is added to the foot of every email that goes outside the company: the Outlook drafts the app makes (orders, variation instructions, PQQs, snag lists, tender enquiries, RFI queries) and the emails the app sends itself (minutes, chasers, sign-in codes). An admin sets it once in <b>Settings › Email signature</b>: edit the box, or copy your signature out of Outlook and paste it in, then press <b>Save signature</b>. The sender’s own name, job title and phone are filled in on drafts and minutes (use <b>Insert sender’s name, title and phone</b> to place them), and the du Boulay logo picture is included. <b>Back to the standard signature</b> undoes your changes.
        </p>
      </>
    ),
  },
]

export default function Help() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string>(SECTIONS[0].id)
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase()
    if (!w) return SECTIONS
    return SECTIONS.filter((s) => s.title.toLowerCase().includes(w) || s.group.toLowerCase().includes(w) || textOf(s.body).toLowerCase().includes(w))
  }, [q])
  const groups = [...new Set(shown.map((s) => s.group))]

  return (
    <div className="help-page">
      <aside className="help-menu">
        <a className="help-logo" href="/">
          <img src="/dbp-logo.svg" alt="du Boulay Projects" />
        </a>
        <input type="search" placeholder="Search the guide…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the guide" />
        <nav>
          {groups.map((g) => (
            <div key={g}>
              <div className="help-group">{g}</div>
              {shown
                .filter((s) => s.group === g)
                .map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className={open === s.id ? 'on' : ''}
                    onClick={() => {
                      setOpen(s.id)
                      setQ('')
                    }}
                  >
                    {s.title}
                  </a>
                ))}
            </div>
          ))}
          {!shown.length && <p className="muted small">Nothing matches.</p>}
        </nav>
        <p className="muted small">Guide updated {UPDATED}</p>
      </aside>
      <main className="help-main">
        <h1>How to use the DBP app</h1>
        <p className="muted">A walk through the main parts. Use the menu on the left or the search box. This guide is kept up to date as features are added.</p>
        {shown.map((s) => (
          <section key={s.id} id={s.id} className="card help-section">
            <h2>{s.title}</h2>
            {s.body}
          </section>
        ))}
      </main>
    </div>
  )
}

// the plain words of a section, for the search box
function textOf(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join(' ')
  const el = n as { props?: { children?: ReactNode } }
  return textOf(el.props?.children)
}
