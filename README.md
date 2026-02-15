# MTN Muhasebe ERP (Kurumsal Çoklu Pencere)

Bu sürüm, gerçek operasyon kullanımına odaklı olarak yeniden kurgulandı:
- **Multi-window Electron**: Her modül ayrı pencere.
- **SQLite WAL + migration**: JSON omurga kaldırıldı.
- **Double-entry muhasebe motoru**: Journal voucher + line zorunlu, dengesiz kayıt reddi.
- **RBAC + hash parola**: Varsayılan şifre yok, ilk açılışta admin kurulumu.
- **Append-only audit log** ve şifreli backup/restore.

## Modül Pencereleri
Ana menüden açılan pencereler:
- Cari, Stok, Satış, Alış, Kasa, Banka, Teklif, Fatura, Raporlar, Ayarlar, Kullanıcılar, Yedekleme

## Çalıştırma
```bash
npm install
npm start
```

## Test
```bash
npm test
```
(15+ muhasebe motoru senaryosu)

## Dizin Yapısı
- `src/main`: Electron main, window manager, db, ipc, services
- `src/renderer`: modül pencereleri
- `src/shared`: constants + validation
- `migrations`: SQL migration dosyaları
- `tests`: muhasebe motoru testleri
