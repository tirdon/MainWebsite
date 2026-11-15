// Curriculum vitae template.
//
// assets/js/ui/cv.js compiles this file in the browser with the Typst
// WebAssembly compiler when "Download Resume" is pressed. Every word comes from
// cv.json, which that script builds from the tags in index.html, so this file
// holds layout only. To change wording, edit index.html; to change the look,
// edit this file.
//
// The shape of cv.json is whatever readPage() in cv.js returns. To work on the
// layout with the Typst CLI, save that object next to this file as cv.json
// and run: typst watch cv.typ

#let cv = json("cv.json")

#let ink = black
#let quiet = luma(90)

#set document(title: cv.title, author: cv.name)
#set page(
  paper: "a4",
  margin: (x: 2.1cm, top: 1.9cm, bottom: 2cm),
  footer: context {
    // Only multi-page documents need a running footer.
    let pages = counter(page).final().first()
    if pages > 1 {
      set text(size: 8.5pt, fill: quiet)
      cv.name
      h(1fr)
      [#counter(page).get().first() / #pages]
    }
  },
)
#set text(font: "New Computer Modern", size: 10.5pt, fill: ink, lang: "en")
#set par(justify: true, leading: 0.6em, spacing: 0.75em)
#set list(indent: 0.4em, body-indent: 0.6em, spacing: 0.55em)
#show link: set text(fill: ink)
// Short bullet lines look gappy when stretched to the margin.
#show list: set par(justify: false)

// "Expertise (Peritiae)": the English heading with its Latin gloss, then a rule.
#let section(title) = {
  if title == none or title.text == "" { return }
  block(above: 1.35em, below: 0.75em, sticky: true, {
    text(size: 12.5pt, weight: "bold", title.text)
    if title.latin != "" {
      h(0.45em)
      text(size: 10pt, style: "italic", fill: quiet, "(" + title.latin + ")")
    }
    v(0.32em, weak: true)
    line(length: 100%, stroke: 0.5pt + ink)
  })
}

// One timeline item: title on the left, dates on the right, details below.
#let entry(item) = block(width: 100%, below: 1em, {
  block(sticky: true, below: 0.55em, grid(
    columns: (1fr, auto),
    column-gutter: 1.2em,
    align: (left + top, right + top),
    par(justify: false, text(weight: "bold", item.title)),
    text(style: "italic", item.date),
  ))
  for note in item.notes {
    par(note)
  }
  if item.points.len() > 0 {
    list(..item.points.map(point => {
      if point.label != "" {
        text(weight: "bold", point.label)
        if point.text != "" { [ --- ] }
      }
      point.text
    }))
  }
})

// ── Name ──
#align(center, {
  text(size: 23pt, weight: "bold", cv.name)
  if cv.subtitle != "" {
    v(0.7em, weak: true)
    text(size: 11pt, style: "italic", cv.subtitle)
  }
})
#v(0.5em)

// ── About ──
#if cv.about.body != "" {
  section(cv.about.heading)
  par(cv.about.body)
}

// ── Expertise ──
#if cv.skills.groups.len() > 0 {
  section(cv.skills.heading)
  grid(
    columns: (auto, 1fr),
    column-gutter: 1.4em,
    row-gutter: 0.62em,
    ..cv.skills.groups.map(group => (
      text(weight: "bold", group.name),
      par(justify: false, group.items.map(item => {
        if group.showLevels and item.level != "" { item.name + " (" + lower(item.level) + ")" } else { item.name }
      }).join(", ")),
    )).flatten(),
  )
}

// ── Experience ──
#if cv.experience.entries.len() > 0 {
  section(cv.experience.heading)
  cv.experience.entries.map(entry).join()
}

// ── Education ──
#if cv.education.entries.len() > 0 {
  section(cv.education.heading)
  cv.education.entries.map(entry).join()
}

// ── Contact ──
#if cv.contact.links.len() > 0 {
  section(cv.contact.heading)
  if cv.contact.intro != "" {
    par(cv.contact.intro)
  }
  grid(
    columns: (auto, 1fr),
    column-gutter: 1.4em,
    row-gutter: 0.62em,
    ..cv.contact.links.map(item => (
      text(weight: "bold", item.label),
      if item.url != "" { link(item.url, item.text) } else { item.text },
    )).flatten(),
  )
}
