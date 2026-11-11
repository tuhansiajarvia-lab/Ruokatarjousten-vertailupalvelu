//import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import OpenAI from 'openai';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.resolve(__dirname, '../db');

// Luodaan kansio, jos sitä ei ole olemassa
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Tietokantakansio luotu: ${dbDir}`);
}

const dbPath = path.join(dbDir, 'products.db');
console.log(`Tietokantatiedoston polku: ${dbPath}`);

// Tietokannan alustus
const db = new Database(dbPath);

// Luodaan tietokantataulu rakenteelle, joka tukee kaikkia kenttiä
db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT,
        catalog_folder TEXT,
        page INTEGER,
        product_name TEXT,
        price REAL,
        original_price REAL,
        discount_percent INTEGER,
        offer_type TEXT,
        unit TEXT,
        discount TEXT,
        raw_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_name, price)
    )
`);

// Luodaan SQL-lisäyskysely nimetyillä parametreillä
const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO products (store, catalog_folder, page, product_name, price, original_price, discount_percent, offer_type, unit, discount, raw_text) 
    VALUES (@store, @catalog_folder, @page, @product_name, @price, @original_price, @discount_percent, @offer_type, @unit, @discount, @raw_text)
`);

// Yhdistetään paikalliseen Ollamaan
const deepseek = new OpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama'
});

// Rekursiivinen funktio PNG-tiedostojen etsimiseen
function getPngFiles(dirPath) {
    let results = [];
    if (!fs.existsSync(dirPath)) return results;
    
    const list = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of list) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
            results = results.concat(getPngFiles(fullPath));
        } else if (file.name.toLowerCase().endsWith('.png')) {
            results.push(fullPath);
        }
    }
    return results;
}

// Sivun jäsennys- ja tallennusfunktio SQLiteen
async function parsePageAndSale(filePath) {
    console.log(`Kuvatiedoston lukeminen: ${filePath}`);
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');

    const prompt = `
    Extract products from this supermarket catalog page into a JSON object with a key "products" containing an array of items.
    Each item must have:
    - "product_name": string (product name in Finnish)
    - "price": number (regular/current price)
    - "original_price": number or null (old price before discount, if present)
    - "discount_percent": number or null (discount percentage as a number, e.g. 14 for -14%, or null)
    - "offer_type": string or null (e.g. "Tarjous", "Club", or null)
    - "unit": string or null (unit of measure like "kg", "l", "kpl", or null)
    - "discount": string or null (e.g. "-20%" or text discount info, or null)
    `;

    const response = await deepseek.chat.completions.create({
        model: "minicpm-v",
        messages: [
            {
                role: "system",
                content: "You are a precise OCR and data extraction assistant that outputs strictly in JSON format."
            },
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/png;base64,${base64Image}`
                        }
                    }
                ]
            }
        ],
        response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    console.log("Vastaus mallilta: \n", content);

    try {
        const parsedData = JSON.parse(content);
        const products = parsedData.products || [];

        if (products.length > 0) {
            // Käytetään transaktiota tuoteerän nopeaan ja turvalliseen tallennukseen
            const insertMany = db.transaction((items) => {
                for (const item of items) {
                    insertStmt.run({
                        store: 'lidl',
                        catalog_folder: path.basename(path.dirname(filePath)),
                        page: 1,
                        product_name: item.product_name || item.name || 'Unknown',
                        price: typeof item.price === 'number' ? item.price : 0,
                        original_price: typeof item.original_price === 'number' ? item.original_price : null,
                        discount_percent: typeof item.discount_percent === 'number' ? item.discount_percent : null,
                        offer_type: item.offer_type || null,
                        unit: item.unit || '',
                        discount: item.discount || '',
                        raw_text: content
                    });
                }
            });

            insertMany(products);
            console.log(`Tuotteet tallennettu onnistuneesti tietokantaan: ${products.length}`);
        } else {
            console.log("Sivulta ei löytynyt tallennettavia tuotteita.");
        }
    } catch (e) {
        console.error("Virhe JSON-jäsennyksessä tai tietokantatallennuksessa:", e.message);
    }
}

// Pääfunktio tuoteluetteloiden läpikäyntiin
async function processAllPages(dir) {
    const files = getPngFiles(dir);
    console.log(`Sivuja löydetty käsiteltäväksi: ${files.length}`);
    
    if (files.length === 0) {
        console.log("Yhtään kuvaa ei löytynyt jäsennettäväksi.");
        return;
    }

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        console.log(`\n--- Tiedoston käsittely [${i + 1}/${files.length}]: ${filePath} ---`);
        
        try {
            await parsePageAndSale(filePath);
        } catch (error) {
            console.error(`Virhe tiedoston käsittelyssä ${filePath}:`, error.message);
        }

        if (i < files.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    console.log('Koko katalogin parsinta ja tallennus tietokantaan suoritettu onnistuneesti!');
}

// Aloitetaan Lidl-tuoteluetteloiden läpikäynti
processAllPages('../catalogs/lidl');