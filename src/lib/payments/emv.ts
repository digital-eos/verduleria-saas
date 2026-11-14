/**
 * Payload EMVCo (el texto que va dentro de un QR de pago), con el mismo formato
 * que los QR dinámicos de Mercado Pago. Se usa SOLO en el modo demo:
 * con la API real, `qr_data` viene armado por Mercado Pago.
 */

/** Campo TLV: id (2) + largo (2) + valor */
const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), el checksum del campo 63 de EMVCo */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Ej: 00020101021243630016com.mercadolibre0139306<uuid>5204970053030325406150.005802AR5904Demo6004CABA6304XXXX
 */
export function buildMercadoPagoLikeQr(opts: { uuid: string; amount: string; merchant?: string; city?: string }) {
  const body =
    tlv("00", "01") + // versión del formato
    tlv("01", "12") + // 12 = QR dinámico (un solo uso)
    tlv("43", tlv("00", "com.mercadolibre") + tlv("01", `306${opts.uuid}`)) + // cuenta Mercado Pago
    tlv("52", "9700") + // rubro (MCC)
    tlv("53", "032") + // moneda: 032 = ARS
    tlv("54", opts.amount) + // importe
    tlv("58", "AR") +
    tlv("59", (opts.merchant ?? "Demo").slice(0, 25)) +
    tlv("60", (opts.city ?? "CABA").slice(0, 15)) +
    "6304";
  return body + crc16(body);
}
