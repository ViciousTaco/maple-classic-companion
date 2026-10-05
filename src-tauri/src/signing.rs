//! Minisign signature checks for the datapack manifest and app updates (plan §8.6, P1-T8).
//! Keys and signatures use the `tauri signer` format: base64 of the minisign text file.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};

/// The release public key (`tauri signer generate` format). Its private half signs every
/// datapack manifest and app update; it never leaves the owner's machine / the CI secret.
pub const UPDATE_PUBLIC_KEY: &str = include_str!("../keys/mcc-update.pub");

/// Lower-case hex SHA-256.
pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_b64_text(b64: &str, what: &str) -> Result<String, String> {
    let bytes = STANDARD.decode(b64.trim()).map_err(|e| format!("{what} is not base64: {e}"))?;
    String::from_utf8(bytes).map_err(|_| format!("{what} is not text"))
}

/// Verifies `data` against a `tauri signer sign` signature using a `tauri signer generate` public key.
pub fn verify(data: &[u8], signature_b64: &str, public_key_b64: &str) -> Result<(), String> {
    let key = PublicKey::decode(&decode_b64_text(public_key_b64, "Public key")?)
        .map_err(|e| format!("Bad public key: {e}"))?;
    let sig = Signature::decode(&decode_b64_text(signature_b64, "Signature")?)
        .map_err(|e| format!("Bad signature: {e}"))?;
    key.verify(data, &sig, false).map_err(|_| "Signature does not match".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DATA: &[u8] = include_bytes!("../tests/fixtures/signed.json");
    const SIG: &str = include_str!("../tests/fixtures/signed.json.sig");
    const KEY: &str = include_str!("../tests/fixtures/test.pub");

    #[test]
    fn signing_accepts_file_signed_by_tauri_signer() {
        verify(DATA, SIG, KEY).unwrap();
    }

    #[test]
    fn signing_rejects_one_byte_change() {
        let mut tampered = DATA.to_vec();
        tampered[10] ^= 1;
        assert!(verify(&tampered, SIG, KEY).is_err());
    }

    #[test]
    fn signing_rejects_garbage_inputs() {
        assert!(verify(DATA, "not base64!", KEY).is_err());
        assert!(verify(DATA, SIG, "bm90IGEga2V5").is_err());
    }

    #[test]
    fn signing_compiled_in_release_key_decodes_and_rejects_test_signatures() {
        assert!(PublicKey::decode(&decode_b64_text(UPDATE_PUBLIC_KEY, "key").unwrap()).is_ok());
        assert!(verify(DATA, SIG, UPDATE_PUBLIC_KEY).is_err()); // signed by the test key, not the release key
    }

    #[test]
    fn signing_sha256_hex_matches_known_vector() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
