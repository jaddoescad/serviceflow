/**
 * Read-only DripJobs contact-history extractor.
 *
 * This function is designed to run in the page context of an authenticated
 * DripJobs tab. Pass records shaped as { row, name, email, phone, contactId }.
 * It returns every visible Notes entry and SMS/Chat message, including the
 * dates supplied by DripJobs. It does not create, update, or delete CRM data.
 */
async function extractDripJobsContactHistory(leads, options = {}) {
  const contactConcurrency = options.contactConcurrency ?? 10;
  const messageConcurrency = options.messageConcurrency ?? 16;

  const clean = (value) =>
    String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const elementText = (element) => {
    if (!element) return "";
    const holder = document.createElement("div");
    holder.innerHTML = element.innerHTML
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|li|tr|blockquote|h[1-6])\s*>/gi, "\n");
    return clean(holder.textContent);
  };

  const fetchHtml = async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    return response.text();
  };

  const mapLimit = async (items, limit, worker) => {
    const output = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(Math.max(1, limit), Math.max(1, items.length)) },
      async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= items.length) return;
          output[index] = await worker(items[index], index);
        }
      },
    );
    await Promise.all(workers);
    return output;
  };

  const contactResults = await mapLimit(
    leads,
    contactConcurrency,
    async (lead) => {
      const contactUrl = `/contacts/edit/${encodeURIComponent(lead.contactId)}`;
      try {
        const html = await fetchHtml(contactUrl);
        const doc = new DOMParser().parseFromString(html, "text/html");

        const allNotes = [...doc.querySelectorAll("#notes .note-card")].map(
          (card) => {
            const times = [...card.querySelectorAll(".note-time")]
              .map((item) => clean(item.textContent))
              .filter(Boolean);
            return {
              date:
                times.find((value) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) ??
                times[0] ??
                "",
              author: clean(card.querySelector(".note-author")?.textContent),
              text: elementText(card.querySelector(".note-bubble")),
            };
          },
        );
        const notes = allNotes.filter((note) => note.text);
        const blankNotes = allNotes
          .filter((note) => !note.text)
          .map(({ date, author }) => ({ date, author }));

        const smsCards = [
          ...doc.querySelectorAll("#sms-messages .data-card"),
        ]
          .map((card) => {
            const href = card
              .querySelector('a[href*="/smsmessages/_view/"]')
              ?.getAttribute("href");
            if (!href) return null;

            const cardText = clean(card.textContent);
            const date =
              cardText.match(/(?:^|\n)Date:\s*([^\n]+)/i)?.[1]?.trim() ?? "";
            const to =
              cardText.match(/(?:^|\n)To:\s*([^\n]+)/i)?.[1]?.trim() ?? "";
            const status = clean(
              card.querySelector(".status-badge, .badge")?.textContent,
            );
            return { href, date, to, status };
          })
          .filter(Boolean);

        return {
          ...lead,
          contactUrl,
          pageTitle: clean(doc.querySelector("title")?.textContent),
          notes,
          blankNotes,
          smsCards,
          chat: [],
          error: "",
        };
      } catch (error) {
        return {
          ...lead,
          contactUrl,
          pageTitle: "",
          notes: [],
          blankNotes: [],
          smsCards: [],
          chat: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const uniqueMessageLinks = [
    ...new Set(
      contactResults.flatMap((contact) =>
        contact.smsCards.map((message) => message.href),
      ),
    ),
  ];

  const messagePairs = await mapLimit(
    uniqueMessageLinks,
    messageConcurrency,
    async (href) => {
      try {
        const html = await fetchHtml(href);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const fields = {};
        for (const row of doc.querySelectorAll("tr")) {
          const cells = [...row.querySelectorAll("th,td")]
            .map((cell) => elementText(cell))
            .filter(Boolean);
          if (cells.length < 2) continue;
          const key = cells[0].replace(/:$/, "").toLowerCase();
          fields[key] = cells.slice(1).join(" ").trim();
        }
        return [
          href,
          {
            href,
            date: fields.date ?? "",
            from: fields.from ?? "",
            to: fields.to ?? "",
            message: fields.message ?? "",
            error: "",
          },
        ];
      } catch (error) {
        return [
          href,
          {
            href,
            date: "",
            from: "",
            to: "",
            message: "",
            error: error instanceof Error ? error.message : String(error),
          },
        ];
      }
    },
  );
  const messagesByHref = new Map(messagePairs);

  return contactResults.map((contact) => ({
    row: contact.row,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    contactId: contact.contactId,
    contactUrl: contact.contactUrl,
    pageTitle: contact.pageTitle,
    notes: contact.notes,
    blankNotes: contact.blankNotes,
    chat: contact.smsCards.map((card) => ({
      ...(messagesByHref.get(card.href) ?? {
        href: card.href,
        date: "",
        from: "",
        to: "",
        message: "",
        error: "Message detail was not returned",
      }),
      date: messagesByHref.get(card.href)?.date || card.date,
      to: messagesByHref.get(card.href)?.to || card.to,
      status: card.status,
    })),
    error: contact.error,
  }));
}
