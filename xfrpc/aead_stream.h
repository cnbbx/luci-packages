// SPDX-License-Identifier: GPL-3.0-only
/*
 * Framed AEAD stream compatible with fatedier/golib crypto.AEADStream{Reader,Writer}.
 * Used by frp wire protocol v2 control-channel encryption (AES-256-GCM).
 */

#ifndef XFRPC_AEAD_STREAM_H
#define XFRPC_AEAD_STREAM_H

#include <stddef.h>
#include <stdint.h>

#define AEAD_KEY_SIZE 32
#define AEAD_GCM_NONCE_SIZE 12
#define AEAD_GCM_TAG_SIZE 16
#define AEAD_MAX_PAYLOAD 65536

struct aead_writer {
	uint8_t key[AEAD_KEY_SIZE];
	uint8_t stream_nonce[AEAD_GCM_NONCE_SIZE];
	uint8_t nonce[AEAD_GCM_NONCE_SIZE];
	int header_sent;
	uint64_t frame_count;
};

struct aead_reader {
	uint8_t key[AEAD_KEY_SIZE];
	uint8_t stream_nonce[AEAD_GCM_NONCE_SIZE];
	uint8_t nonce[AEAD_GCM_NONCE_SIZE];
	int header_read;
	uint64_t frame_count;
	uint8_t *ct_buf;
	size_t ct_len;
	size_t ct_cap;
	uint8_t *pt_buf;
	size_t pt_len;
	size_t pt_cap;
};

int aead_writer_init(struct aead_writer *w, const uint8_t key[AEAD_KEY_SIZE]);
void aead_writer_free(struct aead_writer *w);
int aead_writer_seal(struct aead_writer *w, const uint8_t *pt, size_t pt_len,
		     uint8_t **out, size_t *out_len);

int aead_reader_init(struct aead_reader *r, const uint8_t key[AEAD_KEY_SIZE]);
void aead_reader_free(struct aead_reader *r);
/* Append ciphertext bytes; decrypt complete frames into r->buf. Returns 0 or -1. */
int aead_reader_feed(struct aead_reader *r, const uint8_t *ct, size_t ct_len);

int hkdf_sha256_32(const uint8_t *ikm, size_t ikm_len,
		   const uint8_t *salt, size_t salt_len,
		   const uint8_t *info, size_t info_len,
		   uint8_t out[AEAD_KEY_SIZE]);

int derive_v2_control_keys(const uint8_t *token, size_t token_len,
			   const uint8_t transcript[32],
			   const char *algorithm,
			   uint8_t c2s[AEAD_KEY_SIZE],
			   uint8_t s2c[AEAD_KEY_SIZE]);

#endif
