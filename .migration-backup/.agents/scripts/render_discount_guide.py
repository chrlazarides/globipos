from pathlib import Path
import fitz

source = Path("attached_assets/odigos_gia_prosfores_kai_ekptoseis_1788905351773.pdf")
output = Path(".agents/outputs/discount-guide")
output.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"pages={document.page_count}")

keywords = (
    "προηγούμενη τιμή",
    "μείωση τιμής",
    "έκπτωση",
    "προσφορά",
    "30 ημερών",
    "μοναδιαία",
)

for index, page in enumerate(document):
    text = page.get_text()
    lowered = text.lower()
    if any(keyword in lowered for keyword in keywords):
        print(f"\n--- PAGE {index + 1} ---\n{text[:6000]}")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        pixmap.save(output / f"page-{index + 1}.png")