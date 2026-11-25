## **Overview**

The core idea of **V-ALET** is to download publicly available supermarket catalogs, recognize product data from their pages, and present it in a convenient user interface so shoppers can easily find the best deals.

---

## **How to Run**

Run the pipeline step by step in the following order:

1. **`dloader.js`** — Downloads publicly available catalog pages and images and saves them locally for processing.
2. **`newparser.js`** — Processes the downloaded catalog images using a local vision model via Ollama to extract structured product information and stores the results in the SQLite database (`products.db`).
3. **`server.js`** — Starts the backend server and serves the data to the frontend user interface for browsing, searching, and comparing offers.

---

## **Project Status**

The end-to-end pipeline is up and running. Currently, the main focus is refining accurate data extraction from catalog images, such as product names, prices, units, and discounts.
