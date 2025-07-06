const guidelineSelect = document.getElementById("guideline-select");
const fetchButton = document.getElementById("fetch-button");
const resultsSection = document.getElementById("results");

let guidelineMap = {}; // maps displayed ID -> full entry

function parseSnapshotDate(input) {
    if (!input) return null;
    const [day, month, year] = input.split('/');
    if (!day || !month || !year) return null;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function loadGuidelines() {
    try {
        const url = `https://api.magicapp.org/api/v2/content/guidelines?limit=1000` +
            `&pubAfter=2000-01-01&pubBefore=2030-01-01` +
            `&createAfter=2000-01-01&createBefore=2050-01-01`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load guidelines: HTTP ${res.status}`);
        const data = await res.json();

        guidelineSelect.innerHTML = "";

        data
            .filter(g => !g.name.includes("#DELETE THIS#")) // ⬅️ NEW: filter out deleted
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .forEach(g => {
                const idToUse = g.publishedId || g.guidelineId;
                const option = document.createElement("option");
                option.value = idToUse;
                option.textContent = g.name;
                guidelineMap[idToUse] = g;
                guidelineSelect.appendChild(option);
            });

        if (data.length === 0) {
            resultsSection.innerHTML = `<p>No guidelines found with date filters. 🤔</p>`;
        }

    } catch (err) {
        console.error("Error loading guidelines:", err);
        resultsSection.innerHTML = `<p>Failed to load guidelines. Check console.</p>`;
    }
}

async function fetchRecommendations() {
    const selectedId = guidelineSelect.value;
    const rawDate = document.getElementById("date-input").value;
    const snapshotDate = parseSnapshotDate(rawDate); // ⬅️ NEW: parse input date
    const guidelineEntry = guidelineMap[selectedId];

    const tryIds = [];
    if (guidelineEntry.publishedId) tryIds.push(guidelineEntry.publishedId);
    if (!tryIds.includes(guidelineEntry.guidelineId)) tryIds.push(guidelineEntry.guidelineId);

    resultsSection.innerHTML = `<em>Loading recommendations...</em>`;

    let recommendations = null;

    for (let id of tryIds) {
        try {
            let url = `https://api.magicapp.org/api/v2/guidelines/${id}/recommendations`;
            if (snapshotDate) {
                url += `?date=${snapshotDate}`; // ⬅️ NEW: attach query param
            }

            const res = await fetch(url);
            if (res.ok) {
                recommendations = await res.json();
                break;
            }
        } catch (err) {
            console.warn(`Fetch failed for ID ${id}:`, err);
        }
    }

    if (!recommendations || recommendations.length === 0) {
        resultsSection.innerHTML = "<p>No recommendations found for this guideline.</p>";
        return;
    }

    const filtered = recommendations; // filtering now handled by API using `date=`

    if (filtered.length === 0) {
        resultsSection.innerHTML = "<p>No recommendations found for selected date.</p>";
        return;
    }

    // Load sections using fallback strategy
    let sectionMap = {};
    const sectionIdsToTry = [];
    if (guidelineEntry.publishedId) sectionIdsToTry.push(guidelineEntry.publishedId);
    if (!sectionIdsToTry.includes(guidelineEntry.guidelineId)) sectionIdsToTry.push(guidelineEntry.guidelineId);

    for (let id of sectionIdsToTry) {
        try {
            const res = await fetch(`https://api.magicapp.org/api/v1/guidelines/${id}/sections`);
            if (res.ok) {
                const sections = await res.json();
                sectionMap = Object.fromEntries(
                    sections.map(s => {
                        const title =
                            s.heading?.trim() ||
                            `${s.sectionLabel || s.sectionType || 'Section'} ${s.sectionNumber || ''}`.trim();
                        return [String(s.sectionId), title];
                    })
                );
                console.log(`✅ Loaded sections using ID ${id}`, sectionMap);
                break;
            } else {
                console.warn(`❌ Section fetch failed for guideline ${id}: ${res.status}`);
            }
        } catch (err) {
            console.error(`🚨 Error fetching sections for ${id}`, err);
        }
    }

    const html = filtered.map(rec => {
        const title = sectionMap[String(rec.sectionId)] || "Untitled Section";
        return `
      <div class="recommendation">
        <h3>${title}</h3>
        <p>${rec.text || "(No text available)"}</p>
        <small>Last updated: ${rec.lastUpdated || "unknown"}</small>
      </div>
      <hr />
    `;
    });

    resultsSection.innerHTML = html.join("");
}

// Init
loadGuidelines();
fetchButton.addEventListener("click", fetchRecommendations);
