"""Figure 7: confusion matrix of the classifier on the Leakage-Free Subset.

Mirrors plot_confusion() in scripts/evaluate.py (Greys colormap instead of Blues, rows = true,
cols = predicted, labels real=0 / fake=1) using the leakage_free numbers
recorded in results/detection_metrics.json. The title is left out because
the caption goes under the figure in the thesis.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

CLASS_NAMES = ["real", "fake"]
# results/detection_metrics.json -> leakage_free -> matrix_rows_true_cols_pred
cm = np.array([[1372, 27],
               [43, 1357]])

plt.rcParams.update({"font.family": "serif",
                     "font.serif": ["Times New Roman", "Liberation Serif", "DejaVu Serif"],
                     "font.size": 12})

# white -> charcoal grey (softer than pure black for print)
GREYS = LinearSegmentedColormap.from_list("soft_greys", ["#fafafa", "#3a3a3a"])

fig, ax = plt.subplots(figsize=(5, 4.4))
im = ax.imshow(cm, cmap=GREYS, vmin=0)
ax.set_xticks([0, 1], labels=CLASS_NAMES)
ax.set_yticks([0, 1], labels=CLASS_NAMES)
ax.set_xlabel("Predicted class")
ax.set_ylabel("True class")

peak = cm.max()
row_tot = cm.sum(axis=1)
for i in range(2):
    for j in range(2):
        colour = "white" if cm[i, j] > peak / 2 else "black"
        ax.text(j, i - 0.07, f"{cm[i, j]:,}", ha="center", va="center",
                color=colour, fontsize=16, fontweight="bold")
        ax.text(j, i + 0.13, f"{cm[i, j] / row_tot[i]:.1%} of {row_tot[i]:,}",
                ha="center", va="center", color=colour, fontsize=10)

cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
cbar.set_label("Number of images")
fig.tight_layout()
fig.savefig("Figure 07 - Confusion matrix (Leakage-Free Subset, from evaluate.py).png",
            dpi=300, bbox_inches="tight")
