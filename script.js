const guidelineSelect = document.getElementById("guideline-select");
const fetchButton = document.getElementById("fetch-button");
const resultsSection = document.getElementById("results");

let guidelineMap = {}; // maps displayed ID -> full entry

function parseSnapshotDate(input) {
    if (!input) return null;
    const [day, month, year] = input.split('/');
    if (!day || !month || !year) return null;
    return `${year}-${month.padStart(2, '0')}-${day}`;
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
            .filter(g => !g.name.includes("#DELETE THIS#"))
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
    const snapshotDate = parseSnapshotDate(rawDate);
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
                url += `?date=${snapshotDate}`;
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
        exportButton.style.display = "none";
        return;
    }

    const filtered = recommendations;

    if (filtered.length === 0) {
        resultsSection.innerHTML = "<p>No recommendations found for selected date.</p>";
        exportButton.style.display = "none";
        return;
    }

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
    exportButton.style.display = "inline-block";
}

const exportButton = document.getElementById("export-pdf-button");

exportButton.addEventListener("click", async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "pt", "a4");
    const content = document.getElementById("pdf-export-container");

    const selectedOption = guidelineSelect.options[guidelineSelect.selectedIndex];
    const title = selectedOption?.textContent || "Guideline Summary";

    try {
        // Remove all images first to avoid CORS issues
        document.querySelectorAll("#results img").forEach(img => {
            console.log("🧹 Skipping image from PDF:", img);
            img.remove();
        });

        // Render content as canvas
        const canvas = await html2canvas(content, {
            scale: 2,
            useCORS: true,
            removeContainer: true,
            windowWidth: content.scrollWidth,
            ignoreElements: (el) => el.tagName === "IMG"
        });

        if (!canvas || !canvas.toDataURL) throw new Error("Canvas failed to render.");

        const imgData = canvas.toDataURL("image/png");
        if (!imgData.startsWith("data:image/png;base64,")) {
            throw new Error("Canvas produced invalid image data.");
        }

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 40;

        // ✨ Title wrapping logic
        const maxTitleWidth = pageWidth - 2 * margin;
        const titleLines = doc.splitTextToSize(title, maxTitleWidth);
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(18);
        doc.text(titleLines, margin, margin);

        const titleHeight = titleLines.length * 24;
        let y = margin + titleHeight + 20;

        // Calculate dimensions for image placement
        const imgWidth = pageWidth - 2 * margin;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let remainingHeight = imgHeight;
        const imgHeightRatio = canvas.height / canvas.width;
        let position = y;

        while (remainingHeight > 0) {
            doc.addImage(imgData, "PNG", margin, position, imgWidth, imgWidth * imgHeightRatio);
            remainingHeight -= pageHeight - position;
            if (remainingHeight > 0) {
                doc.addPage();
                position = margin;
            }
        }

        doc.save(`${title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.pdf`);
    } catch (error) {
        console.error("PDF export failed:", error);
        alert("Oops! Something went wrong while generating the PDF.\n\nTry with fewer results or refresh the page and try again.");
    }
});

// Init
loadGuidelines();
fetchButton.addEventListener("click", fetchRecommendations);
