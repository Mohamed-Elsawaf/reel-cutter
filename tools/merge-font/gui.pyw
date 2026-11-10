"""Small window for merge.py: pick an Arabic font and a Latin font, build, install. Double-click to run."""
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox

sys.path.insert(0, str(Path(__file__).resolve().parent))
import merge  # noqa: E402

FONT_TYPES = [("TrueType fonts", "*.ttf"), ("All files", "*.*")]


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("دمج الخطوط — Reel Cutter")
        self.resizable(False, False)
        self.arabic = tk.StringVar(value=str(merge.DEFAULT_ARABIC) if merge.DEFAULT_ARABIC.exists() else "")
        self.latin = tk.StringVar(value=str(merge.DEFAULT_LATIN) if merge.DEFAULT_LATIN.exists() else "")
        self.name = tk.StringVar(value="")
        self.scale = tk.DoubleVar(value=100.0)
        self.baseline = tk.DoubleVar(value=0.0)
        self.shared_ar = tk.BooleanVar(value=False)
        self.install = tk.BooleanVar(value=True)
        self.last = None

        pad = dict(padx=6, pady=4)
        r = 0
        tk.Label(self, text="الخط العربي (الأساس):").grid(row=r, column=2, sticky="e", **pad)
        tk.Entry(self, textvariable=self.arabic, width=60).grid(row=r, column=1, **pad)
        tk.Button(self, text="اختار…", command=lambda: self.pick(self.arabic)).grid(row=r, column=0, **pad)
        r += 1
        tk.Label(self, text="الخط الإنجليزي:").grid(row=r, column=2, sticky="e", **pad)
        tk.Entry(self, textvariable=self.latin, width=60).grid(row=r, column=1, **pad)
        tk.Button(self, text="اختار…", command=lambda: self.pick(self.latin)).grid(row=r, column=0, **pad)
        r += 1
        tk.Label(self, text="اسم الخط الجديد (فاضي = تلقائي):").grid(row=r, column=2, sticky="e", **pad)
        tk.Entry(self, textvariable=self.name, width=30).grid(row=r, column=1, sticky="e", **pad)
        r += 1
        tk.Label(self, text="حجم الإنجليزي %:").grid(row=r, column=2, sticky="e", **pad)
        tk.Scale(self, variable=self.scale, from_=60, to=140, resolution=1, orient="horizontal", length=360).grid(row=r, column=1, sticky="e", **pad)
        r += 1
        tk.Label(self, text="ارفع/نزّل الإنجليزي %:").grid(row=r, column=2, sticky="e", **pad)
        tk.Scale(self, variable=self.baseline, from_=-20, to=20, resolution=0.5, orient="horizontal", length=360).grid(row=r, column=1, sticky="e", **pad)
        r += 1
        tk.Checkbutton(self, text="الأرقام 0-9 والعلامات من الخط العربي بدل الإنجليزي", variable=self.shared_ar).grid(row=r, column=1, sticky="e", **pad)
        r += 1
        tk.Checkbutton(self, text="سطّب الخط على الجهاز بعد ما يتعمل (اقفل بريمير وافتحه بعدها)", variable=self.install).grid(row=r, column=1, sticky="e", **pad)
        r += 1
        self.btn = tk.Button(self, text="اعمل الخط", width=20, command=self.run)
        self.btn.grid(row=r, column=1, sticky="e", **pad)
        tk.Button(self, text="افتح الفولدر", command=self.open_out).grid(row=r, column=0, **pad)
        r += 1
        self.log = tk.Text(self, width=80, height=8)
        self.log.grid(row=r, column=0, columnspan=3, **pad)
        tk.Label(self, text="للاستخدام الشخصي بس — الخط المدمج ما يتوزعش (رخص الخطوط).", fg="gray").grid(row=r + 1, column=0, columnspan=3, **pad)

    def pick(self, var):
        p = filedialog.askopenfilename(filetypes=FONT_TYPES, initialdir=str(Path(var.get()).parent) if var.get() else None)
        if p:
            var.set(p)

    def write(self, text):
        self.log.insert("end", text + "\n")
        self.log.see("end")

    def open_out(self):
        import os
        merge.DEFAULT_OUT.mkdir(parents=True, exist_ok=True)
        os.startfile(str(merge.DEFAULT_OUT))

    def run(self):
        a, l = Path(self.arabic.get()), Path(self.latin.get())
        if not a.is_file() or not l.is_file():
            messagebox.showerror("دمج الخطوط", "اختار ملف الخط العربي والإنجليزي الأول")
            return
        self.btn.config(state="disabled")
        log = lambda t: self.after(0, self.write, t)

        def work():
            try:
                out = merge.merge(a, l, self.name.get().strip() or None, self.scale.get(), self.baseline.get(),
                                  self.shared_ar.get(), merge.DEFAULT_OUT, log=log)
                if self.install.get():
                    from fontTools.ttLib import TTFont
                    merge.install_for_user(out, TTFont(str(out))["name"].getDebugName(1), log=log)
                    log("اقفل بريمير وافتحه تاني عشان الخط يظهر.")
            except Exception as e:  # show any error in the window
                log("خطأ: " + str(e))
            finally:
                self.after(0, lambda: self.btn.config(state="normal"))

        threading.Thread(target=work, daemon=True).start()


if __name__ == "__main__":
    App().mainloop()
