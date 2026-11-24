// The project hub link on the outside pages (24 Nov): large, at the bottom of the page. One SharePoint link per job (jobs.hub_url,
// script 078), managed by Document Control: the latest drawings and project documents.
export default function HubBlock({ url, project }: { url: string; project?: string }) {
  return (
    <section className="hub-block">
      <div>
        <h2>Project hub</h2>
        <p>{project ? `${project}: ` : ''}the latest drawings and project documents.</p>
      </div>
      <a className="hub-open" href={url} target="_blank" rel="noreferrer">
        Open the project hub ↗
      </a>
    </section>
  )
}
