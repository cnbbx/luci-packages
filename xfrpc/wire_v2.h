// SPDX-License-Identifier: GPL-3.0-only
/*
 * frp wire protocol v2: magic, JSON hello frames, binary message frames.
 * See fatedier/frp pkg/proto/wire and pkg/msg/wire_v2.go (v0.69+).
 */

#ifndef XFRPC_WIRE_V2_H
#define XFRPC_WIRE_V2_H

#include <stddef.h>
#include <stdint.h>
#include "msg.h"

#define WIRE_V2_MAGIC "FRP\x00\x02\r\n"
#define WIRE_V2_MAGIC_LEN 7

#define WIRE_V2_FRAME_CLIENT_HELLO 1
#define WIRE_V2_FRAME_SERVER_HELLO 2
#define WIRE_V2_FRAME_MESSAGE 16

#define WIRE_V2_ALG_AES256GCM "aes-256-gcm"

int wire_protocol_is_v2(void);
void wire_v2_reset(void);

uint16_t wire_v2_msg_type_to_id(enum msg_type t);
enum msg_type wire_v2_id_to_msg_type(uint16_t id);

int wire_v2_encode_frame(uint16_t type, const uint8_t *payload, uint32_t plen,
			 uint8_t **out, size_t *out_len);
/* Parse one frame from buf. Returns bytes consumed, 0 if incomplete, -1 on error. */
int wire_v2_parse_frame(const uint8_t *buf, size_t len, uint16_t *type,
			const uint8_t **payload, uint32_t *plen);

int wire_v2_build_client_hello_json(const char *transport, int tls, int tcp_mux,
				    uint8_t **json, size_t *jlen);
int wire_v2_parse_server_hello_json(const uint8_t *json, size_t jlen,
				    char *alg, size_t alg_sz,
				    char *errbuf, size_t err_sz);

void wire_v2_hash_transcript(const uint8_t *ch, size_t chlen,
			     const uint8_t *sh, size_t shlen,
			     uint8_t out[32]);

int wire_v2_encode_message(enum msg_type t, const char *json, size_t jlen,
			   uint8_t **out, size_t *out_len);

/* Convert a v2 message payload (typeID + json) into a heap v1 msg_hdr. */
int wire_v2_payload_to_v1(const uint8_t *payload, uint32_t plen,
			  uint8_t **v1, size_t *v1_len);

#endif
