from datasets import load_from_disk
import os

# Dataset already downloaded to data/celebdf
# Labels: 0 = Fake, 1 = Real
ds = load_from_disk("data/celebdf")
print(ds)
print("Features:", ds["train"].features)

os.makedirs("data/celebdf/real", exist_ok=True)
os.makedirs("data/celebdf/fake", exist_ok=True)

for split in ds:
    print(f"Exporting {split} split...")
    for i, example in enumerate(ds[split]):
        label = example["label"]
        img = example["image"]
        folder = "real" if label == 1 else "fake"
        img.save(f"data/celebdf/{folder}/{split}_{i}.jpg")
        if i % 5000 == 0:
            print(f"  {split}: {i}/{len(ds[split])}")

print("Done.")
print("real:", len(os.listdir("data/celebdf/real")))
print("fake:", len(os.listdir("data/celebdf/fake")))
