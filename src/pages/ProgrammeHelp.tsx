import { Link } from 'react-router-dom'
import '../programme.css'

// Help › Programme: how to use the programme (DBP Timeline built into the app), rebuilt from Timeline's
// own help page (https://du-boulay-timeline.web.app/help.html, read 22 Nov) with everything added in
// the app: automatic saving, Commit and the original programme, the overlay, previous programmes,
// estimates, the cashflow and procurement, the full-page view and the keyboard shortcuts.
const SECTIONS = [
  ['start', 'Getting started'],
  ['tasks', 'Adding & editing tasks'],
  ['sections', 'Sections & duplicating floors'],
  ['links', 'Linking tasks'],
  ['dates', 'Dates & working days'],
  ['shutdowns', 'Christmas & shutdowns'],
  ['critical', 'Critical path'],
  ['colours', 'Colours & the legend'],
  ['big', 'Moving around a big programme'],
  ['saving', 'Saving, Commit & history'],
  ['compare', 'The original programme & slippage (EOT)'],
  ['previous', 'Starting from a previous programme'],
  ['files', 'Files, print & export'],
  ['app', 'How it links to the rest of the app'],
  ['undo', 'Mistakes, Undo & Redo'],
  ['keys', 'Keyboard shortcuts'],
] as const

export const SHORTCUTS: [string[], string][] = [
  [['N'], 'Jump to the quick-add box'],
  [['Enter'], 'In quick add: add the task'],
  [['T'], 'New task (the full task form)'],
  [['M'], 'New milestone'],
  [['L'], 'Link mode on / off'],
  [['Shift', 'click'], 'In link mode: a start-to-start link'],
  [['C'], 'Critical path view on / off'],
  [['1', '2', '3', '4'], 'Zoom: Day / Week / Fortnight / Month'],
  [['.'], 'Jump to today'],
  [['F'], 'Full page on / off'],
  [['Ctrl', 'Z'], 'Undo'],
  [['Ctrl', 'Y'], 'Redo (or Ctrl + Shift + Z)'],
  [['Ctrl', 'S'], 'Save now (it saves by itself anyway)'],
  [['Ctrl', 'P'], 'Print the programme (A3, or save as PDF)'],
  [['Ctrl', 'Enter'], 'In the task form: save the task'],
  [['Esc'], 'Leave link mode / close a menu or dialog / cancel an edit / leave full page'],
  [['?'], 'Show the keyboard shortcuts'],
  [['Shift', 'wheel'], 'Scroll the chart sideways'],
]
export function Keys({ keys }: { keys: string[] }) {
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
            A construction programme on each job (and each estimate): your tasks on the left, a Gantt chart on the right; link them together and the dates follow. It's DBP
            Timeline, built into the app.
          </p>
        </div>
      </div>
      <div className="tl-help-layout">
        <nav className="tl-help-toc card">
          <div className="tl-legend-title">On this page</div>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="tl-help-body">
          <section className="card" id="start">
            <h2>Getting started</h2>
            <p>
              Open the job and go to its <b>Programme</b> tab (for a tender, open the enquiry in Estimating and use its <b>Programme</b> box). With no programme yet, start one of
              four ways:
            </p>
            <ul>
              <li>
                <b>Start from a previous programme</b>: copy another job's or estimate's programme, moved to a new start date (see <a href="#previous">below</a>).
              </li>
              <li>
                <b>Import it</b> from DBP Timeline (.json), Primavera P6 (.xer) or MS Project (.xml).
              </li>
              <li>
                <b>Make a simple one from the SoW</b> (jobs only): a first draft from the job's trades, to edit.
              </li>
              <li>
                <b>Start a blank one</b>: with Start on site and Practical Completion milestones, or empty.
              </li>
            </ul>
            <p>
              Then give it a name in the <b>Project</b> box, set <b>Programme starts</b> to the date of the very first task and, if there's a precon period,{' '}
              <b>Start on site (Wk 1)</b>. Type your first task in the <b>Quick add</b> bar and press <kbd>Enter</kbd>; keep typing, and each new task starts straight after the one
              before.
            </p>
            <div className="tl-tip">
              <b>Set Programme starts first.</b> A date typed without a year, such as 4/1, becomes the first 4 January on or after it, so a programme running into next year gets
              the right year. It's separate from Start on site (Wk 1): precon dates come before site start, so they're read from the first task, not from Wk 1.
            </div>
          </section>

          <section className="card" id="tasks">
            <h2>Adding & editing tasks</h2>
            <ul>
              <li>
                <b>Quick add:</b> type a name, pick the trade and the duration in working days, press <kbd>Enter</kbd>. Press <kbd>N</kbd> anywhere to jump there.
              </li>
              <li>
                <b>Link to previous</b> (ticked by default): the new task follows the one before it, finish to start, so you build a chain just by typing.
              </li>
              <li>
                <b>+ Task</b> (<kbd>T</kbd>) and <b>+ Milestone</b> (<kbd>M</kbd>) open the full task form. Milestones are diamonds.
              </li>
              <li>
                <b>Click any task</b> (its row or its bar) to open it: name, section, trade, contractor, start, duration, milestone, skeleton crew, RAG, predecessors, and whether
                its prerequisites are confirmed (with a note). <kbd>Ctrl</kbd> + <kbd>Enter</kbd> saves it.
              </li>
              <li>
                <b>Quick edits in the list:</b> click a start date or the days to type a new value; click the RAG dot to go green → amber → red.
              </li>
              <li>
                <b>Drag a bar</b> to move it, or its right-hand end to change its length. Tasks that follow it move too.
              </li>
              <li>
                <b>Duplicate</b> in the task form makes a copy straight after it, then opens the copy.
              </li>
              <li>
                <b>Drag a row</b> in the list to re-order (on a touch screen, drag by its <b>⋮⋮</b> grip). The <b>⇅</b> by Start sorts each section by start date.
              </li>
              <li>
                <b>Contractor:</b> type or pick from the app's contractor list. The <b>All contractors</b> menu shows (and prints) one contractor's tasks only.
              </li>
            </ul>
          </section>

          <section className="card" id="sections">
            <h2>Sections & duplicating floors</h2>
            <ul>
              <li>Sections (Precon, Floor 1, Close-out…) group tasks under a navy header bar.</li>
              <li>
                <b>+ Section ▾</b> adds a blank section, or the <b>Precon</b> / <b>Close-out</b> starter tasks.
              </li>
              <li>Click a section's name to rename it; ▾ collapses it; ▲ ▼ (or drag the header) move the whole section.</li>
              <li>
                Hover a task and click the <b>＋</b> at its right-hand end to split a section: that task and everything after it move into a new section.
              </li>
            </ul>
            <h3>Repeating floors, blocks or plots</h3>
            <ol>
              <li>Build and tidy one floor first, then click the duplicate icon on its section header.</li>
              <li>Choose the number of copies and the first copy's name (Floor 1 → Floor 2, Floor 3…).</li>
              <li>
                Timing: each copy starts N working days after the previous one <b>starts</b> (staggered, the usual way) or after it <b>finishes</b> (back to back).
              </li>
              <li>
                <b>Link the copies together</b> (on by default) so each floor follows the one before and they move together.
              </li>
            </ol>
            <p>Links inside the section are copied; links to tasks outside it (e.g. “Frame complete”) stay on every copy.</p>
            <p>
              <b>Deleting a section</b> asks whether to delete the header only (the tasks stay, without a section) or the header and its tasks. Either can be undone.
            </p>
          </section>

          <section className="card" id="links">
            <h2>Linking tasks</h2>
            <p>A link makes one task wait for another: when the first moves, the second follows.</p>
            <h3>Quickest way: link mode</h3>
            <ol>
              <li>
                Press <b>Link tasks</b> (<kbd>L</kbd>).
              </li>
              <li>Click the task that comes first (its bar or its row).</li>
              <li>
                Click the task that depends on it. They're linked, and the second becomes the next starting point, so you can click straight down a list to chain a run of tasks.
              </li>
              <li>
                Press <kbd>Esc</kbd> or <b>Done</b> when finished.
              </li>
            </ol>
            <ul>
              <li>
                <kbd>Shift</kbd>-click the second task for a <b>start-to-start</b> link (both start together).
              </li>
              <li>Click a pair that's already linked to remove the link.</li>
              <li>A link that would make a loop (A waits for B, B waits for A) is refused, with a message.</li>
            </ul>
            <h3>Lags and other link types</h3>
            <p>
              Open a task and use <b>Predecessors</b>: FS (finish to start), SS (start to start) or FF (finish to finish), with a lag in working days (negative to overlap).
            </p>
            <div className="tl-tip">
              A linked task starts as soon as its links allow. If you type or drag a new start for it, the app keeps the links and adds the difference to their lag, so it stays
              where you put it.
            </div>
          </section>

          <section className="card" id="dates">
            <h2>Dates & working days</h2>
            <ul>
              <li>Durations are working days, Monday to Friday, less any shutdowns. Weekends are shaded and skipped.</li>
              <li>
                <b>Typing dates:</b> 4/1, 4/1/27 and 4/1/2027 all work (day/month). Without a year, Programme starts decides the year.
              </li>
              <li>
                <b>Week numbers</b> run along the top (Wk 1, Wk 2…); weeks before Week 1 count down (Wk -3, -2, -1) for precon. Week 1 is worked out automatically, or set it with{' '}
                <b>Start on site (Wk 1)</b>; ✕ goes back to automatic.
              </li>
              <li>
                <b>Set baseline</b> when the programme's agreed: the Slip column then shows each task's start against it. (For an EOT, use the original programme: see{' '}
                <a href="#compare">below</a>.)
              </li>
            </ul>
          </section>

          <section className="card" id="shutdowns">
            <h2>Christmas & shutdowns</h2>
            <ul>
              <li>
                If the programme runs over Christmas, <b>Shutdown ▾</b> gets a red dot. Open it and click <b>Add</b> to block out the break (two Mon–Fri weeks from the Monday of
                Christmas Eve's week). Edit the dates, rename it, or add other periods such as Easter.
              </li>
              <li>No work is scheduled on those days: tasks stretch across the break and later tasks move out. Shutdowns are shaded pink on the chart and in print.</li>
              <li>
                <b>Skeleton crew:</b> tick it on a task and it keeps working through shutdowns.
              </li>
              <li>Remove a shutdown and tasks pull back automatically.</li>
            </ul>
          </section>

          <section className="card" id="critical">
            <h2>Critical path</h2>
            <ul>
              <li>
                The critical path is the chain of tasks with <b>no float</b>: if any of them slips, the finish slips. It's worked out from your links and durations.
              </li>
              <li>Critical tasks have a red outline on the chart, a red name in the list, and red link arrows between them.</li>
              <li>
                <b>Critical path (N)</b> (<kbd>C</kbd>) fades everything else; press again to restore. N is how many are critical.
              </li>
              <li>It only works properly when tasks are linked: unlinked tasks have nothing holding them in sequence.</li>
            </ul>
          </section>

          <section className="card" id="colours">
            <h2>Colours & the legend</h2>
            <ul>
              <li>
                Bars are coloured by trade. <b>Legend</b> → click a swatch to change that trade's colour everywhere.
              </li>
              <li>
                <b>Brand colours</b> recolours every trade from the du Boulay palette; <b>Tone down</b> softens them all (Undo reverses either).
              </li>
              <li>The legend also explains the RAG dots, milestone diamonds, the critical path outline and shutdowns.</li>
              <li>
                <b>Client logo…</b> adds the client's logo to the programme and its print.
              </li>
            </ul>
          </section>

          <section className="card" id="big">
            <h2>Moving around a big programme</h2>
            <ul>
              <li>
                <b>Full page</b> (<kbd>F</kbd>, the first button after the dates) fills the browser with the programme, over the sidebar and the job's heading. <kbd>Esc</kbd> or{' '}
                <b>Exit full page</b> goes back.
              </li>
              <li>The week/month ruler and the task names stay put; the list and chart scroll together.</li>
              <li>
                Scroll sideways with the scrollbar, <kbd>Shift</kbd> + mouse wheel, or a trackpad swipe.
              </li>
              <li>
                Zoom with <b>Day / Week / Fortnight / Month</b> (<kbd>1</kbd>–<kbd>4</kbd>). <b>Today</b> (<kbd>.</kbd>) jumps to the current date.
              </li>
              <li>Collapse sections you're not working on with their ▾. Drag a column heading's edge to resize it.</li>
              <li>On a phone the toolbar scrolls sideways and the list shows just the task names and RAG; menus open full width.</li>
            </ul>
          </section>

          <section className="card" id="saving">
            <h2>Saving, Commit & history</h2>
            <p>Programmes are part of the job, so everyone signed in sees the same one. There's no Save button to remember:</p>
            <table className="tl-help-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Saving</b>
                    <br />
                    <span className="muted small">automatic</span>
                  </td>
                  <td>
                    Every change is saved a moment after you make it (<kbd>Ctrl</kbd> + <kbd>S</kbd> saves straight away). The label by the project name says <b>Saved</b>,{' '}
                    <b>Saving…</b> or <b>Not saved – retry</b> (e.g. with no signal: your changes are kept on the page and saved when you're back online).
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Commit</b>
                  </td>
                  <td>
                    Locks the programme as it is now as a numbered revision, with a note (e.g. “Contract programme at award”, “Issued to client”). Revisions run Initial issue → Rev
                    A → Rev B… You carry on editing the working programme as normal.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>History</b>
                  </td>
                  <td>
                    Every committed revision with its note and date. <b>What changed</b> lists what moved against the one before; you can also see the changes since the last commit
                    and since the original. <b>Overlay</b> draws it under the bars; <b>Download</b> saves it as a file; <b>Restore</b> makes it the working programme again
                    (undoable).
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="tl-tip">Commit at points you'd want to compare or go back to: at contract award, before a big change, when issuing to the client.</div>
          </section>

          <section className="card" id="compare">
            <h2>The original programme & slippage (EOT)</h2>
            <ul>
              <li>
                The <b>first commit</b> is the <b>original programme</b> (the box in the Commit dialog is ticked for you). Any later revision can be made the original instead:
                History → <b>Make original</b>.
              </li>
              <li>
                <b>Compare ▾</b> overlays the original (or any revision) on today's programme: a grey line under each bar where it was, and the slippage between its finish then and
                now hatched <span className="tl-red">red</span> (later) or <span className="tl-green">green</span> (earlier).
              </li>
              <li>
                While comparing, the <b>Slip</b> column shows each task's finish against it (+7d, −2d, on time, new), with the working days in its tip.
              </li>
              <li>
                The bar above the chart gives completion then and now (Practical Completion, if there's a milestone of that name), e.g. “29/03/2027 → 05/04/2027 (+7 days, +5
                working days)”, and how many tasks are later, earlier, new or removed.
              </li>
              <li>
                <b>Print / PDF</b> while comparing prints the overlay, with “Compared with …” in the header: ready to go with an extension of time claim.
              </li>
            </ul>
          </section>

          <section className="card" id="previous">
            <h2>Starting from a previous programme</h2>
            <ul>
              <li>
                <b>Programmes</b> in the toolbar (or the first box when a job has no programme yet) lists every job's and estimate's programme. Search, pick one, set the new start
                date and use it.
              </li>
              <li>
                It's copied with its first task on the new date, keeping the pattern of the weeks in working days, the links, sections and trades. RAG, progress and baselines are
                cleared; shutdowns aren't copied (Christmas is offered again).
              </li>
              <li>
                <b>New</b> clears the programme to start again. Committed revisions are kept in History either way.
              </li>
            </ul>
          </section>

          <section className="card" id="files">
            <h2>Files, print & export</h2>
            <ul>
              <li>
                <b>Save file</b> downloads the programme as a DBP Timeline .json file (opens in Timeline too). <b>Open file…</b> replaces the programme with a .json, P6 .xer or MS
                Project .xml file (in MS Project: File → Save As → XML).
              </li>
              <li>
                <b>Print / PDF</b> (<kbd>Ctrl</kbd> + <kbd>P</kbd>): A3 landscape pages with the task list and chart, the DBP and client logos, a title block (project, revision,
                status, date, sheet), sections carried over with “(continued)”. Choose “Save as PDF” in the print window. It follows the contractor filter, the critical path view
                and the overlay.
              </li>
              <li>
                <b>Export ▾</b>: Primavera P6 (.xer), MS Project (.xml) or the Timeline file.
              </li>
            </ul>
          </section>

          <section className="card" id="app">
            <h2>How it links to the rest of the app</h2>
            <ul>
              <li>
                <b>Cashflow:</b> the cashflow spreads each package's value over its programme activities, so it follows the programme as you edit it.
              </li>
              <li>
                <b>Procurement:</b> each package's “on site (provisional)” date is the first programme activity for it, so order-by dates move with the programme.
              </li>
              <li>
                <b>Estimating:</b> a tender's programme lives on its enquiry; when the enquiry is won and set up as a job, its programme becomes the job's.
              </li>
            </ul>
          </section>

          <section className="card" id="undo">
            <h2>Mistakes, Undo & Redo</h2>
            <ul>
              <li>
                <b>Undo</b> (<kbd>Ctrl</kbd> + <kbd>Z</kbd>) reverses the last change: an edit, a drag, deleting a task or section, duplicating, shifting, restoring a revision… It
                remembers the last 30. <b>Redo</b> (<kbd>Ctrl</kbd> + <kbd>Y</kbd>) puts it back.
              </li>
              <li>Undo works while you stay on the page; the saved programme follows whatever you undo to.</li>
              <li>
                For anything older, open <b>History</b> and restore a committed revision.
              </li>
            </ul>
          </section>

          <section className="card" id="keys">
            <h2>Keyboard shortcuts</h2>
            <p className="muted small">Single letters work when you're not typing in a box. Press ? on the programme to see this list there.</p>
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
        </div>
      </div>
    </div>
  )
}
