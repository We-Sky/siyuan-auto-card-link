from PIL import Image, ImageDraw
from pathlib import Path

img = Image.new('RGB', (256, 256), '#edf4ef')
d = ImageDraw.Draw(img)
d.rounded_rectangle((28, 48, 228, 208), radius=25, fill='#ffffff', outline='#c4d9ca', width=3)
d.rounded_rectangle((45, 69, 211, 120), radius=10, fill='#47775f')
d.rounded_rectangle((47, 143, 174, 154), radius=5, fill='#4b6054')
d.rounded_rectangle((47, 169, 143, 177), radius=4, fill='#b8c9be')
img.save('icon.png')
# Build needs a preview file; the browser screenshot replaces this placeholder.
if not Path('preview.png').exists():
    Image.new('RGB', (1200, 800), '#edf4ef').save('preview.png')
