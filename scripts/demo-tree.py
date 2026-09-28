import json
import sys

counter = [0]


def mark(title, url):
    counter[0] += 1
    return {"id": f"b{counter[0]}", "title": title, "url": url, "type": "bookmark"}


def folder(title, children):
    counter[0] += 1
    return {"id": f"f{counter[0]}", "title": title, "type": "folder", "children": children}


toolbar = [
    mark("Hacker News", "https://news.ycombinator.com/"),
    mark("The Guardian", "https://www.theguardian.com/international"),
    mark("MDN Web Docs", "https://developer.mozilla.org/en-US/"),
    mark("GitHub", "https://github.com/"),
    mark("Wikipedia", "https://en.wikipedia.org/"),
    folder("Every morning", [
        mark("LWN.net", "https://lwn.net/"),
        mark("Ars Technica", "https://arstechnica.com/"),
        mark("The Verge", "https://www.theverge.com/"),
        mark("Phoronix", "https://www.phoronix.com/"),
        mark("Slashdot", "https://slashdot.org/"),
    ]),
]

reading = folder("Reading", [
    mark("The Death of the Newsweekly", "https://www.theatlantic.com/magazine/"),
    mark("Longreads: Best of the year", "https://longreads.com/best-of/"),
    mark("Why buildings fall down", "https://www.nytimes.com/section/science"),
    mark("Aeon Essays", "https://aeon.co/essays"),
    mark("The Marginalian", "https://www.themarginalian.org/"),
    mark("Quanta Magazine", "https://www.quantamagazine.org/"),
])

rust = folder("Rust", [
    mark("The Rust Programming Language", "https://doc.rust-lang.org/book/"),
    mark("Rust by Example", "https://doc.rust-lang.org/rust-by-example/"),
    mark("crates.io: the Rust package registry", "https://crates.io/"),
    mark("Rust Atomics and Locks", "https://marabos.nl/atomics/"),
    mark("Learning Rust With Entirely Too Many Linked Lists", "https://rust-unofficial.github.io/too-many-lists/"),
])

go = folder("Go", [
    mark("The Go Programming Language", "https://go.dev/"),
    mark("Effective Go", "https://go.dev/doc/effective_go"),
    mark("Go by Example", "https://gobyexample.com/"),
    mark("pkg.go.dev", "https://pkg.go.dev/"),
])

dev = folder("Development", [
    rust,
    go,
    mark("Stack Overflow", "https://stackoverflow.com/"),
    mark("Pro Git book", "https://git-scm.com/book/en/v2"),
    mark("Regex101", "https://regex101.com/"),
    mark("Explain Shell", "https://explainshell.com/"),
    mark("Can I use", "https://caniuse.com/"),
    mark("HTTP status codes", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status"),
    mark("CSS Grid guide", "https://css-tricks.com/snippets/css/complete-guide-grid/"),
    mark("SQLite: The Definitive Guide", "https://www.sqlite.org/docs.html"),
    mark("Python documentation", "https://docs.python.org/3/"),
    mark("PostgreSQL manual", "https://www.postgresql.org/docs/current/"),
])

systems = folder("Systems", [
    mark("Linux kernel documentation", "https://www.kernel.org/doc/html/latest/"),
    mark("systemd for administrators", "https://lwn.net/Articles/475877/"),
    mark("The Arch Wiki", "https://wiki.archlinux.org/"),
    mark("Let's Encrypt documentation", "https://letsencrypt.org/docs/"),
    mark("OWASP Cheat Sheet Series", "https://cheatsheetseries.owasp.org/"),
])

video = folder("Watch later", [
    mark("3Blue1Brown: Essence of linear algebra", "https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab"),
    mark("Computerphile", "https://www.youtube.com/user/Computerphile"),
    mark("The Criterion Collection", "https://www.criterion.com/"),
    mark("IMDb: Top rated movies", "https://www.imdb.com/chart/top/"),
])

travel = folder("Travel", [
    mark("Rome2rio: anywhere to anywhere", "https://www.rome2rio.com/"),
    mark("Seat61: train travel in Europe", "https://www.seat61.com/"),
    mark("OpenStreetMap", "https://www.openstreetmap.org/"),
    mark("Atlas Obscura", "https://www.atlasobscura.com/"),
    mark("Trenitalia", "https://www.trenitalia.com/"),
])

kitchen = folder("Kitchen", [
    mark("Serious Eats: The Food Lab", "https://www.seriouseats.com/the-food-lab"),
    mark("King Arthur Baking recipes", "https://www.kingarthurbaking.com/recipes"),
    mark("Giallo Zafferano", "https://www.giallozafferano.it/"),
    mark("Bon Appetit: Basically", "https://www.bonappetit.com/basically"),
])

rabbit = folder("Rabbit holes", [
    mark("Bathtub curve - Wikipedia", "https://en.wikipedia.org/wiki/Bathtub_curve"),
    mark("Carrington Event - Wikipedia", "https://en.wikipedia.org/wiki/Carrington_Event"),
    mark("Dvorak keyboard layout - Wikipedia", "https://en.wikipedia.org/wiki/Dvorak_keyboard_layout"),
    mark("Fermi paradox - Wikipedia", "https://en.wikipedia.org/wiki/Fermi_paradox"),
    mark("Great Molasses Flood - Wikipedia", "https://en.wikipedia.org/wiki/Great_Molasses_Flood"),
    mark("Hanlon's razor - Wikipedia", "https://en.wikipedia.org/wiki/Hanlon%27s_razor"),
    mark("Kessler syndrome - Wikipedia", "https://en.wikipedia.org/wiki/Kessler_syndrome"),
    mark("Mpemba effect - Wikipedia", "https://en.wikipedia.org/wiki/Mpemba_effect"),
    mark("Sealand - Wikipedia", "https://en.wikipedia.org/wiki/Principality_of_Sealand"),
    mark("Shipping container - Wikipedia", "https://en.wikipedia.org/wiki/Intermodal_container"),
    mark("Tacoma Narrows Bridge - Wikipedia", "https://en.wikipedia.org/wiki/Tacoma_Narrows_Bridge_(1940)"),
    mark("Voynich manuscript - Wikipedia", "https://en.wikipedia.org/wiki/Voynich_manuscript"),
])

menu = [reading, rabbit, dev, systems, video, travel, kitchen,
        mark("Internet Archive", "https://archive.org/"),
        mark("Project Gutenberg", "https://www.gutenberg.org/")]

unfiled = [
    mark("Bandcamp Daily", "https://daily.bandcamp.com/"),
    mark("Figma", "https://www.figma.com/"),
    mark("Have I Been Pwned", "https://haveibeenpwned.com/"),
    mark("Public APIs", "https://github.com/public-apis/public-apis"),
    mark("Awesome Self-Hosted", "https://github.com/awesome-selfhosted/awesome-selfhosted"),
    mark("Nginx admin guide", "https://docs.nginx.com/nginx/admin-guide/"),
]


def roots():
    def root(rid, title, children):
        return {"id": rid, "title": title, "type": "folder", "children": children}

    tree = root("root________", "", [
        root("toolbar_____", "Bookmarks Toolbar", toolbar),
        root("menu________", "Bookmarks Menu", menu),
        root("unfiled_____", "Other Bookmarks", unfiled),
        root("mobile______", "Mobile Bookmarks", []),
    ])

    def walk(node, parent=None):
        for index, child in enumerate(node.get("children", [])):
            child["parentId"] = node["id"]
            child["index"] = index
            walk(child, node)

    walk(tree)
    tree["index"] = 0
    return [tree]


json.dump(roots(), open(sys.argv[1], "w"))
print("bookmarks:", counter[0])
