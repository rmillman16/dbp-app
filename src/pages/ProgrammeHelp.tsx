import { Link } from 'react-router-dom'
import '../programme.css'

// Help › Programme: how to use the programme (DBP Timeline built into the app), rebuilt from Timeline's
// own help page (https://du-boulay-timeline.web.app/help.html, read 22 Nov) and extended with everything
// added in the app. Opened from the programme's Help button (and ?) in a new tab.
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Basics',
    items: [
      ['start', 'Getting started'],
      ['screen', 'The screen at a glance'],
      ['toolbar', 'The toolbar, button by button'],
    ],
  },
  {
    title: 'Building the programme',
    items: [
      ['tasks', 'Adding & editing tasks'],
      ['form', 'The task form'],
      ['list', 'The task list columns'],
      ['sections', 'Sections & duplicating floors'],
      ['links', 'Linking tasks'],
      ['dates', 'Dates & working days'],
      ['shutdowns', 'Christmas & shutdowns'],
      ['shift', 'Shifting the programme'],
    ],
  },
  {
    title: 'Reading the chart',
    items: [
      ['chart', 'What the chart shows'],
      ['critical', 'Critical path'],
      ['colours', 'Colours & the legend'],
      ['big', 'Moving around a big programme'],
    ],
  },
  {
    title: 'Tracking & EOT',
    items: [
      ['saving', 'Saving, Commit & history'],
      ['compare', 'The original programme & slippage'],
    ],
  },
  {
    title: 'Starting, sharing & the rest of the app',
    items: [
      ['previous', 'Previous programmes & From SoW'],
      ['files', 'Files, print & export'],
      ['app', 'Cashflow, procurement & estimating'],
      ['phone', 'Phones & tablets'],
    ],
  },
  {
    title: 'Reference',
    items: [
      ['undo', 'Mistakes, Undo & Redo'],
      ['keys', 'Keyboard shortcuts'],
      ['trouble', 'Troubleshooting'],
      ['glossary', 'Glossary'],
    ],
  },
]

const SHORTCUTS: [string[], string][] = [
  [['N'], 'Jump to the quick-add box'],
  [['Enter'], 'In quick add: add the task'],
  [['T'], 'New task (the full task form)'],
  [['M'], 'New milestone'],
  [['L'], 'Link mode on / off'],
  [['Shift', 'click'], 'In link mode: a start-to-start link'],
  [['C'], 'Critical path view on / off'],
  [['1', '2', '3', '4'], 'Zoom: D / W / 2W / M'],
  [['.'], 'Jump to today'],
  [['F'], 'Full page on / off'],
  [['Ctrl', 'Z'], 'Undo'],
  [['Ctrl', 'Y'], 'Redo (or Ctrl + Shift + Z)'],
  [['Ctrl', 'S'], 'Save now (it saves by itself anyway)'],
  [['Ctrl', 'P'], 'Print the programme (A3, or save as PDF)'],
  [['Ctrl', 'Enter'], 'In the task form: save the task'],
  [['Enter'], 'In a start or days cell: keep the new value'],
  [['Esc'], 'Leave link mode / close a menu or dialog / cancel an edit / leave full page'],
  [['?'], 'Open this help at the shortcuts'],
  [['Shift', 'wheel'], 'Scroll the chart sideways'],
]
function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="tl-keys">
      {keys.map((k, i) => (
        <span key={i}>
          {i > 0 && (keys.length === 4 ? ' / ' : ' + ')}
          <kbd>{k}</kbd>
        </span>
      ))}
    </span>
  )
}
const Row = ({ k, children }: { k: React.ReactNode; children: React.ReactNode }) => (
  <tr>
    <td>{k}</td>
    <td>{children}</td>
  </tr>
)

export default function ProgrammeHelp() {
  return (
    <div className="tl-help-page">
      <div className="job-head">
        <div>
          {window.history.length > 1 ? (
            <button className="link-button small" onClick={() => window.history.back()}>
              ← Back
            </button>
          ) : (
            <Link to="/" className="link-button small">
              ← Home
            </Link>
          )}
          <h1>Programme: help, tips & shortcuts</h1>
          <p className="muted">
            A construction programme on each job (and each estimate): tasks on the left, a Gantt chart on the right; link them together and the dates follow. It's DBP Timeline,
            built into the app, so the cashflow and procurement work from it.
          </p>
        </div>
      </div>
      <div className="tl-help-layout">
        <nav className="tl-help-toc card">
          {GROUPS.map((g) => (
            <div key={g.title} className="tl-help-toc-group">
              <div className="tl-legend-title">{g.title}</div>
              {g.items.map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="tl-help-body">
          {/* ---------------- Basics ---------------- */}
          <h2 className="tl-help-group">Basics</h2>
          <section className="card" id="start">
            <h2>Getting started</h2>
            <p>
              Open the job and go to its <b>Programme</b> tab (for a tender, open the enquiry in Estimating and use its <b>Programme</b> box). With no programme yet, start one of
              four ways:
            </p>
            <ul>
              <li>
                <b>Start from a previous programme</b>: copy another job's or estimate's programme, moved to a new start date.
              </li>
              <li>
                <b>Import it</b> from DBP Timeline (.json), Primavera P6 (.xer) or MS Project (.xml).
              </li>
              <li>
                <b>Make a simple one from the SoW</b> (jobs): a first draft from the job's trades.
              </li>
              <li>
                <b>Start a blank one</b>: with Start on site and Practical Completion milestones, or empty.
              </li>
            </ul>
            <ol>
              <li>
                Set <b>Start</b> to the date of the very first task (e.g. LOI or the start of precon).
              </li>
              <li>
                If there's a precon period, set <b>Start on site (Wk 1)</b>.
              </li>
              <li>
                Type the first task in <b>Quick add</b> and press <kbd>Enter</kbd>. Keep typing: each new task starts straight after the one before and is linked to it.
              </li>
              <li>
                When it's agreed (e.g. at contract award), press <b>Commit</b>: the first commit is the <b>original programme</b> that slippage is measured against.
              </li>
            </ol>
            <div className="tl-tip">
              <b>Set Start first.</b> A date typed without a year, such as 4/1, becomes the first 4 January on or after it, so a programme running into next year gets the right
              year. It's separate from Start on site (Wk 1): precon comes before site start.
            </div>
          </section>

          <section className="card" id="screen">
            <h2>The screen at a glance</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Toolbar, line 1</b>}>Icons: full page, new, undo, redo, open, print, export; Tools; the saved badge; Start; Start on site (Wk 1); the client logo.</Row>
                <Row k={<b>Toolbar, line 2</b>}>
                  Programmes, From SoW, Commit, History; + Task, + Milestone, + Section; D / W / 2W / M; Link tasks, Critical path, contractor filter; Help.
                </Row>
                <Row k={<b>Quick add</b>}>Type a task name and press Enter; pick its trade and days; Link to previous.</Row>
                <Row k={<b>Task list</b>}>Task, Trade, Start, Days, RAG, Prereq, Slip, and a grip to drag. Navy bands are sections.</Row>
                <Row k={<b>Chart</b>}>Week numbers along the top, bars coloured by trade, links as arrows, today as a blue line (the . key scrolls to it).</Row>
                <Row k={<b>Bands above the chart</b>}>Appear for link mode (what to click next) and Compare (completion then and now).</Row>
              </tbody>
            </table>
          </section>

          <section className="card" id="toolbar">
            <h2>The toolbar, button by button</h2>
            <h3>Line 1</h3>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>⛶ Full page</b>}>
                  Fills the browser with the programme, over the sidebar and job heading (<kbd>F</kbd>; <kbd>Esc</kbd> to leave).
                </Row>
                <Row k={<b>New</b> /* file icon */}>Clears the programme to start again. Committed revisions stay in History.</Row>
                <Row k={<b>Undo / Redo</b>}>
                  The curved arrows (<kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd>). Hover to see what they'll undo or redo.
                </Row>
                <Row k={<b>Open file</b>}>The folder: replaces the programme with a .json, .xer or .xml file.</Row>
                <Row k={<b>Print</b>}>
                  The printer: A3 landscape pages, or save as PDF (<kbd>Ctrl</kbd> + <kbd>P</kbd>). Untick <b>Today line</b> to leave the dashed today line off.
                </Row>
                <Row k={<b>Export</b>}>The down arrow: MS Project (.xml), Primavera P6 (.xer) or a DBP Timeline file (.json).</Row>
                <Row k={<b>Tools ▾</b>}>
                  <b>Shutdown</b> (Christmas etc.), <b>Shift</b> (the whole programme or a section), <b>Compare</b> (overlay the original or a revision), <b>Legend</b> (trade
                  colours and symbols), <b>Add client logo</b>. A red dot means the programme runs over Christmas with no shutdown yet.
                </Row>
                <Row k={<b>✓ Rev A</b>}>The saved badge: ✓ saved (⟳ saving, ! Retry if it couldn't save), and the last commit. Hover for when.</Row>
                <Row k={<b>Start</b>}>The date of the very first task; new tasks start here, and it decides the year for dates typed without one.</Row>
                <Row k={<b>Start on site (Wk 1)</b>}>The week that's Wk 1. Blank: worked out from the Construction section. ✕ goes back to automatic.</Row>
              </tbody>
            </table>
            <h3>Line 2</h3>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Programmes</b>}>Copy another job's or estimate's programme into this one, moved to a new start date.</Row>
                <Row k={<b>From SoW…</b>}>(Jobs) a simple programme from the job's SoW trades, replacing this one.</Row>
                <Row k={<b>Commit</b>}>Locks a numbered copy: Initial issue, Rev A, Rev B… The first is the original programme.</Row>
                <Row k={<b>History</b>}>Committed revisions: what changed, overlay, make original, download, restore.</Row>
                <Row k={<b>+ Task / + Milestone</b>}>
                  The full task form (<kbd>T</kbd> / <kbd>M</kbd>).
                </Row>
                <Row k={<b>+ Section ▾</b>}>A blank section, or the Precon / Close-out starter tasks.</Row>
                <Row k={<b>D / W / 2W / M</b>}>
                  Zoom: day, week, fortnight, month (<kbd>1</kbd>–<kbd>4</kbd>).
                </Row>
                <Row k={<b>Link tasks</b>}>
                  Link mode: click the first task, then the one that follows it (<kbd>L</kbd>).
                </Row>
                <Row k={<b>Critical path (N)</b>}>
                  Fades everything not on the critical path (<kbd>C</kbd>). N is how many tasks are critical.
                </Row>
                <Row k={<b>All contractors ▾</b>}>Shows (and prints) one contractor's tasks only.</Row>
                <Row k={<b>Help</b>}>This page.</Row>
              </tbody>
            </table>
          </section>

          {/* ---------------- Building ---------------- */}
          <h2 className="tl-help-group">Building the programme</h2>
          <section className="card" id="tasks">
            <h2>Adding & editing tasks</h2>
            <ul>
              <li>
                <b>Quick add:</b> type a name, pick the trade and the duration in working days, press <kbd>Enter</kbd>. Press <kbd>N</kbd> anywhere to jump there.
              </li>
              <li>
                <b>Link to previous</b> (ticked by default): the new task follows the one before it, so you build a chain just by typing.
              </li>
              <li>
                <b>+ Task</b> (<kbd>T</kbd>) and <b>+ Milestone</b> (<kbd>M</kbd>) open the full task form.
              </li>
              <li>
                <b>Click any task</b> (its row or its bar) to open it.
              </li>
              <li>
                <b>Quick edits in the list:</b> click a start date or the days to type a new value (<kbd>Enter</kbd> keeps it, <kbd>Esc</kbd> cancels); click the RAG dot to go
                green → amber → red.
              </li>
              <li>
                <b>Drag a bar</b> to move it, or its right-hand end to change its length. Tasks that follow it move too.
              </li>
              <li>
                <b>Drag a row</b> to re-order (on a touch screen, by its ⋮⋮ grip). ⇅ by Start sorts each section by start date.
              </li>
              <li>
                <b>Duplicate</b> (in the task form) makes a copy straight after it and opens the copy.
              </li>
            </ul>
          </section>

          <section className="card" id="form">
            <h2>The task form</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Task name</b>}>What it is, e.g. “First fix M&E”.</Row>
                <Row k={<b>Section</b>}>The section it sits in (or + Add new section).</Row>
                <Row k={<b>Trade / package</b>}>Colours its bar; the cashflow and procurement match packages by trade.</Row>
                <Row k={<b>Contractor</b>}>Type or pick from the app's contractor list; used by the contractor filter and print.</Row>
                <Row k={<b>Start date / Duration</b>}>Duration is working days. On a linked task, a new start becomes extra lag on its links.</Row>
                <Row k={<b>Milestone</b>}>A single date, shown as a diamond.</Row>
                <Row k={<b>Critical path</b>}>Tick to always show the task as critical (red, and in the critical path view and print), as well as any the links make critical.</Row>
                <Row k={<b>Skeleton crew</b>}>Keeps working through shutdowns (e.g. security, a weekend pour).</Row>
                <Row k={<b>RAG status</b>}>
                  Your own judgement of the task, set by hand at progress meetings: green on track, amber at risk, red off track (e.g. waiting on drawings, a subbie behind). It
                  doesn't move any dates; it flags the tasks to talk about. A small dot on the bar; only amber and red show on the print.
                </Row>
                <Row k={<b>Predecessors</b>}>The tasks it follows: FS, SS or FF, with a lag in working days (negative to overlap).</Row>
                <Row k={<b>Prerequisite confirmed / note</b>}>Whatever must be in place first (drawings, a sample, an order); the Prereq column shows a tick or an amber !.</Row>
              </tbody>
            </table>
            <p>
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd> saves; <b>Delete task</b> removes it and its links; <b>Duplicate</b> copies it.
            </p>
          </section>

          <section className="card" id="list">
            <h2>The task list columns</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Task</b>}>◆ marks a milestone. A red name and red edge: on the critical path.</Row>
                <Row k={<b>Trade</b>}>The trade's colour, and the contractor after a dot.</Row>
                <Row k={<b>Start</b>}>Click to type a new start (4/1, 4/1/27).</Row>
                <Row k={<b>Days</b>}>Working days; click to change. A milestone shows —.</Row>
                <Row k={<b>RAG</b>}>Click to change.</Row>
                <Row k={<b>Prereq</b>}>✓ confirmed, ! not yet (hover for the note).</Row>
                <Row k={<b>Slip</b>}>
                  How far its finish has moved against the <b>original programme</b> (or the revision being compared): <span className="tl-red">+7d</span> later,{' '}
                  <span className="tl-green">−2d</span> earlier, on time, or <b>new</b> (not in the original). Hover for working days. Before the first commit it shows —.
                </Row>
                <Row k={<b>⋮⋮</b>}>Drag to move the row (into another section, too).</Row>
              </tbody>
            </table>
            <p>Drag a column heading's right-hand edge to make it wider or narrower; the widths are remembered on this device.</p>
          </section>

          <section className="card" id="sections">
            <h2>Sections & duplicating floors</h2>
            <ul>
              <li>Sections (Precon, Floor 1, Close-out…) group tasks under a navy band, with how many tasks and their dates.</li>
              <li>
                <b>+ Section ▾</b> adds a blank section, or the <b>Precon</b> / <b>Close-out</b> starter tasks.
              </li>
              <li>Click a section's name to rename it; ▾ collapses it; ▲ ▼ (or drag the band) move it.</li>
              <li>To move tasks into a new section, add it with + Section, then drag the tasks into it (or change each task's Section).</li>
            </ul>
            <h3>Repeating floors, blocks or plots</h3>
            <ol>
              <li>Build and tidy one floor first, then click the duplicate icon on its band.</li>
              <li>Choose the number of copies and the first copy's name (Floor 1 → Floor 2, Floor 3…).</li>
              <li>
                Each copy starts N working days after the previous one <b>starts</b> (staggered) or <b>finishes</b> (back to back).
              </li>
              <li>
                <b>Link the copies together</b> (on by default) so they move together.
              </li>
            </ol>
            <p>Links inside the section are copied; links to outside tasks stay on every copy.</p>
            <p>
              <b>Deleting a section</b> asks: the header only (tasks kept, without a section) or the header and its tasks. Either can be undone.
            </p>
          </section>

          <section className="card" id="links">
            <h2>Linking tasks</h2>
            <p>A link makes one task wait for another: when the first moves, the second follows.</p>
            <h3>Link mode</h3>
            <ol>
              <li>
                Press <b>Link tasks</b> (<kbd>L</kbd>).
              </li>
              <li>
                Click the task that comes first (bar or row), then the one that depends on it. The second becomes the next starting point, so you can chain straight down a list.
              </li>
              <li>
                <kbd>Shift</kbd>-click the second for <b>start-to-start</b>. Click a linked pair again to unlink.
              </li>
              <li>
                <kbd>Esc</kbd> or <b>Done</b> to finish. A link that would make a loop is refused.
              </li>
            </ol>
            <h3>Link types and lags</h3>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>FS</b>}>Finish to start: starts the working day after the other finishes (the usual).</Row>
                <Row k={<b>SS</b>}>Start to start: starts when the other starts.</Row>
                <Row k={<b>FF</b>}>Finish to finish: finishes when the other finishes.</Row>
                <Row k={<b>Lag</b>}>Working days added (e.g. +3 for drying time), or negative to overlap.</Row>
              </tbody>
            </table>
            <div className="tl-tip">
              A linked task starts as soon as its links allow. Give it a new start (typing or dragging) and the app keeps the link, adding the difference to the lag.
            </div>
          </section>

          <section className="card" id="dates">
            <h2>Dates & working days</h2>
            <ul>
              <li>Durations are working days: Monday to Friday, less shutdowns.</li>
              <li>Typing dates: 4/1, 4/1/27 and 4/1/2027 all work (day/month). Without a year, Start decides it.</li>
              <li>Week numbers run along the top (Wk 1, Wk 2…); weeks before Wk 1 count down (Wk -3, -2, -1).</li>
              <li>The programme's own start and finish follow its tasks.</li>
            </ul>
          </section>

          <section className="card" id="shutdowns">
            <h2>Christmas & shutdowns</h2>
            <ul>
              <li>
                <b>Tools ▾ → Shutdown</b>. When the programme runs over Christmas, Tools shows a red dot and the menu offers it: two Mon–Fri weeks from the Monday of Christmas
                Eve's week. Edit the dates, rename it, add others (Easter, a client's closure).
              </li>
              <li>No work on those days: tasks stretch across and later tasks move out. Shaded pink on the chart and the print.</li>
              <li>
                <b>Skeleton crew</b> (task form) keeps a task working through.
              </li>
              <li>Remove a shutdown and tasks pull back.</li>
            </ul>
          </section>

          <section className="card" id="shift">
            <h2>Shifting the programme</h2>
            <ul>
              <li>
                <b>Tools ▾ → Shift</b>, pick the whole programme or one section, the number of days, then <b>Back</b> or <b>Forward</b>.
              </li>
              <li>The whole programme moves by calendar days, taking Start and Wk 1 with it.</li>
              <li>A section moves by working days; its links from outside take the shift as lag, so what follows it moves too.</li>
              <li>Slip (against the original) shows the effect.</li>
            </ul>
          </section>

          {/* ---------------- Reading ---------------- */}
          <h2 className="tl-help-group">Reading the chart</h2>
          <section className="card" id="chart">
            <h2>What the chart shows</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Bar</b>}>A task, coloured by trade, with its name inside or beside it.</Row>
                <Row k={<b>◆</b>}>A milestone.</Row>
                <Row k={<b>Small dot top right</b>}>Its RAG status.</Row>
                <Row k={<b>Red outline</b>}>On the critical path.</Row>
                <Row k={<b>Arrows</b>}>Links (red between critical tasks).</Row>
                <Row k={<b>Grey columns</b>}>Weekends.</Row>
                <Row k={<b>Pink columns</b>}>Shutdowns.</Row>
                <Row k={<b>Blue line</b>}>Today (a dashed red “Today” line on the print, unless you untick it).</Row>
                <Row k={<b>Grey line under a bar</b>}>
                  While comparing: where it was in the original (or the chosen revision); hatched red / green between the old and new finish.
                </Row>
                <Row k={<b>Navy band</b>}>A section.</Row>
              </tbody>
            </table>
          </section>

          <section className="card" id="critical">
            <h2>Critical path</h2>
            <ul>
              <li>
                The chain of tasks with <b>no float</b>: if any slips, completion slips. Worked out from the links and durations, plus any task ticked <b>Critical path</b> in its
                form (e.g. a long-lead order you know is critical before it's linked up).
              </li>
              <li>Critical tasks: red outline, red name, red arrows between them.</li>
              <li>
                <b>Critical path (N)</b> (<kbd>C</kbd>) fades everything else.
              </li>
              <li>It only works properly when tasks are linked.</li>
            </ul>
          </section>

          <section className="card" id="colours">
            <h2>Colours & the legend</h2>
            <ul>
              <li>
                <b>Tools ▾ → Legend</b>: click a trade's swatch to change its colour everywhere.
              </li>
              <li>
                <b>Brand colours</b> recolours every trade from the du Boulay palette; <b>Tone down</b> softens them (Undo reverses either).
              </li>
              <li>The legend also explains RAG, milestones, the critical path and shutdowns.</li>
            </ul>
          </section>

          <section className="card" id="big">
            <h2>Moving around a big programme</h2>
            <ul>
              <li>
                <b>Full page</b> (<kbd>F</kbd>) gives the programme the whole browser.
              </li>
              <li>The headings and task names stay put; the list and chart scroll together.</li>
              <li>
                Scroll sideways with the scrollbar, <kbd>Shift</kbd> + mouse wheel or a trackpad swipe.
              </li>
              <li>
                Zoom with <b>D / W / 2W / M</b>; <kbd>.</kbd> jumps to today.
              </li>
              <li>Collapse sections you're not working on.</li>
              <li>The contractor filter cuts it down to one contractor's tasks.</li>
            </ul>
          </section>

          {/* ---------------- Tracking ---------------- */}
          <h2 className="tl-help-group">Tracking & EOT</h2>
          <section className="card" id="saving">
            <h2>Saving, Commit & history</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Saving</b>}>
                  Automatic, a moment after each change, for everyone (<kbd>Ctrl</kbd> + <kbd>S</kbd> saves straight away). The label by the project name says Saved, Saving… or Not
                  saved – retry. With no signal, changes are kept on the page and saved when you're back online.
                </Row>
                <Row k={<b>Commit</b>}>Locks the programme as it is now as a numbered revision with a note. You carry on editing as normal.</Row>
                <Row k={<b>History</b>}>
                  Every revision with its note and date. <b>What changed</b> lists what moved since the one before; the working programme shows changes since the last commit and
                  since the original. <b>Overlay</b>, <b>Make original</b>, <b>Download</b>, <b>Restore</b> (undoable).
                </Row>
              </tbody>
            </table>
            <div className="tl-tip">Commit at contract award, before a big change and whenever you issue it to the client.</div>
          </section>

          <section className="card" id="compare">
            <h2>The original programme & slippage (EOT)</h2>
            <ul>
              <li>
                The <b>first commit</b> is the <b>original programme</b> (the box in the Commit dialog is ticked for you). History → <b>Make original</b> changes which revision it
                is.
              </li>
              <li>
                The <b>Slip</b> column always measures against it: each task's finish then and now.
              </li>
              <li>
                <b>Tools ▾ → Compare</b> draws the original (or any revision) under the bars, with the slippage hatched <span className="tl-red">red</span> /{' '}
                <span className="tl-green">green</span>. The band above the chart gives completion then and now (Practical Completion, if there's a milestone of that name) in days
                and working days, and how many tasks are later, earlier, new or removed. <b>Hide overlay</b> turns it off.
              </li>
              <li>
                <b>Print</b> while comparing prints the overlay, with “Compared with …” in the header: ready to go with an extension of time claim.
              </li>
              <li>
                <b>On an EOT:</b> slippage isn't claimed automatically (some delays are ours or a subcontractor's). In the job's <b>EOT</b> tab, open a delay event and use{' '}
                <b>Programme slippage</b> to pick the task it affected: its slip against the original programme is quoted on the event, kept as it was that day. Then choose{' '}
                <b>Claim … days</b> / <b>working days</b> and <b>Add to recap</b> (it goes in the notice letter) if you want them.
              </li>
            </ul>
          </section>

          {/* ---------------- Starting, sharing ---------------- */}
          <h2 className="tl-help-group">Starting, sharing & the rest of the app</h2>
          <section className="card" id="previous">
            <h2>Previous programmes & From SoW</h2>
            <ul>
              <li>
                <b>Programmes</b> lists every job's and estimate's programme: search, pick one, set the new start date. It's copied with its first task on that date, keeping the
                pattern of the weeks, the links, sections and trades; RAG and progress are cleared and shutdowns left behind.
              </li>
              <li>
                <b>From SoW…</b> (jobs) makes a simple programme from the SoW's trades between the start and PC dates you give.
              </li>
              <li>Both replace the current programme; committed revisions stay in History, so commit first if you want to keep a copy.</li>
            </ul>
          </section>

          <section className="card" id="files">
            <h2>Files, print & export</h2>
            <ul>
              <li>
                <b>Print</b> (the printer icon, or <kbd>Ctrl</kbd> + <kbd>P</kbd>): A3 landscape pages with the task list and chart, the DBP and client logos, a dashed red line for
                today (untick <b>Today line</b> to leave it off) and a title block (the job's name, revision, status, date, sheet). Sections running onto the next page carry
                “(continued)”. Choose “Save as PDF” in the print window. It follows the contractor filter, the critical path view and the overlay.
              </li>
              <li>
                <b>Export</b> (the down-arrow icon): Primavera P6 (.xer), MS Project (.xml), or a DBP Timeline .json (a copy to keep or send).
              </li>
              <li>
                <b>Open file</b> (folder icon) replaces the programme with any of those files (in MS Project: File → Save As → XML).
              </li>
              <li>
                <b>Tools ▾ → Add client logo</b> puts the client's logo on the programme and its print.
              </li>
            </ul>
          </section>

          <section className="card" id="app">
            <h2>Cashflow, procurement & estimating</h2>
            <ul>
              <li>
                <b>Cashflow:</b> spreads each package's value over its programme activities, so it follows the programme as you edit it.
              </li>
              <li>
                <b>Procurement:</b> a package's “on site (provisional)” date is its first programme activity, so order-by dates move with the programme.
              </li>
              <li>
                <b>Estimating:</b> a tender's programme lives on its enquiry; when the enquiry is won and set up as a job, its programme becomes the job's.
              </li>
            </ul>
          </section>

          <section className="card" id="phone">
            <h2>Phones & tablets</h2>
            <ul>
              <li>The toolbar scrolls sideways; menus open full width.</li>
              <li>On a phone the list shows the task name and RAG; the chart scrolls beside it.</li>
              <li>Tap a task to open it; drag rows by their ⋮⋮ grip (so the list still scrolls); drag bars as normal.</li>
            </ul>
          </section>

          {/* ---------------- Reference ---------------- */}
          <h2 className="tl-help-group">Reference</h2>
          <section className="card" id="undo">
            <h2>Mistakes, Undo & Redo</h2>
            <ul>
              <li>
                <b>Undo</b> (<kbd>Ctrl</kbd> + <kbd>Z</kbd>) reverses the last change: an edit, a drag, deleting, duplicating, shifting, restoring a revision… up to 30 steps.{' '}
                <b>Redo</b> (<kbd>Ctrl</kbd> + <kbd>Y</kbd>) puts it back.
              </li>
              <li>The saved programme follows whatever you undo to.</li>
              <li>
                For anything older, open <b>History</b> and restore a committed revision.
              </li>
            </ul>
          </section>

          <section className="card" id="keys">
            <h2>Keyboard shortcuts</h2>
            <p className="muted small">Single letters work when you're not typing in a box.</p>
            <table className="tl-help-table">
              <tbody>
                {SHORTCUTS.map(([keys, what]) => (
                  <tr key={what}>
                    <td>
                      <Keys keys={keys} />
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card" id="trouble">
            <h2>Troubleshooting</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>“! Retry”</b>}>It couldn't save, usually no signal. Keep the page open; it saves when you're back online, or click Retry.</Row>
                <Row k={<b>A task won't stay where I put it</b>}>It's linked: its links decide its start. Change the lag, or remove the link.</Row>
                <Row k={<b>The critical path looks odd</b>}>Tasks need linking for it to work; unlinked tasks only show as critical if they finish last.</Row>
                <Row k={<b>Commit / History greyed out</b>}>The database update for them hasn't been run yet (ask Richard).</Row>
                <Row k={<b>Compare is greyed out</b>}>Nothing's committed yet: commit first.</Row>
                <Row k={<b>Slip shows —</b>}>There's no original programme yet: commit (the first commit is the original).</Row>
                <Row k={<b>Dates land on the wrong year</b>}>Set Start to the first task's date; dates without a year are read from it.</Row>
                <Row k={<b>A .mpp file won't open</b>}>Browsers can't read .mpp: in MS Project use File → Save As → XML, then open that.</Row>
                <Row k={<b>The print cuts the chart into pages</b>}>It's A3 at a readable size; long programmes run onto more pages, with “(continued)”.</Row>
              </tbody>
            </table>
          </section>

          <section className="card" id="glossary">
            <h2>Glossary</h2>
            <table className="tl-help-table">
              <tbody>
                <Row k={<b>Working day</b>}>Monday to Friday, not in a shutdown.</Row>
                <Row k={<b>Milestone</b>}>A key date with no length (Contract award, PC).</Row>
                <Row k={<b>Predecessor</b>}>A task this one follows.</Row>
                <Row k={<b>Lag</b>}>Working days between linked tasks (negative overlaps them).</Row>
                <Row k={<b>Float</b>}>How long a task can slip before completion slips.</Row>
                <Row k={<b>Critical path</b>}>The tasks with no float.</Row>
                <Row k={<b>Commit / revision</b>}>A locked, numbered copy: Initial issue, Rev A, Rev B…</Row>
                <Row k={<b>Original programme</b>}>The committed revision slippage is measured against (e.g. the contract programme).</Row>
                <Row k={<b>Slip</b>}>How far a task's finish has moved against the original programme.</Row>
                <Row k={<b>Skeleton crew</b>}>A task that keeps working through shutdowns.</Row>
                <Row k={<b>RAG</b>}>Red / amber / green status.</Row>
                <Row k={<b>Wk 1</b>}>The week site starts; weeks before it count down.</Row>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}
