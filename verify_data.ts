import { fetchCoinDetails, formatJPY } from "./lib/dex-service";

async function verify() {
    console.log("--- Verifying PEPE Data ---");
    const pepe = await fetchCoinDetails("pepe");
    if (pepe) {
        console.log(`Name: ${pepe.name}`);
        console.log(`Price: ${pepe.current_price} -> Formatted: ${formatJPY(pepe.current_price)}`);
        console.log(`Description (Start): ${pepe.description.substring(0, 100)}...`);
        console.log(`Is Japanese detected in description? ${/[ぁ-んァ-ン一-龠]/.test(pepe.description)}`);
    } else {
        console.error("Failed to fetch PEPE");
    }

    console.log("\n--- Verifying Ethereum Data ---");
    const eth = await fetchCoinDetails("ethereum");
    if (eth) {
        console.log(`Name: ${eth.name}`);
        console.log(`Price: ${eth.current_price} -> Formatted: ${formatJPY(eth.current_price)}`);
        console.log(`Description (Start): ${eth.description.substring(0, 100)}...`);
        console.log(`Is Japanese detected in description? ${/[ぁ-んァ-ン一-龠]/.test(eth.description)}`);
    } else {
        console.error("Failed to fetch Ethereum");
    }
}

verify();
