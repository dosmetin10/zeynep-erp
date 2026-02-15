# MTN Muhasebe ERP

Elektron tabanlı **Ön Muhasebe + Stok Takip** masaüstü uygulaması.

## Kapsam
Bu sürüm, KOBİ operasyonlarını ayağa kaldırmak için gerekli çekirdek modülleri içerir:

- Cari kart yönetimi (müşteri/tedarikçi)
- Stok kartı, miktar ve birim fiyat yönetimi
- Kasa gelir/gider hareketleri
- Anlık KPI paneli (cari sayısı, stok değeri, kasa bakiye, kritik stok)
- Operasyon rapor özeti
- JSON yedekleme ve yedekten geri yükleme
- Giriş ekranı ve temel kullanıcı doğrulama

## Kurulum
```bash
npm install
npm start
```

## Derleme
```bash
npm run dist
```

## Varsayılan giriş
- `mtn / 1453`
- `muhasebe / 1453`

## Proje yapısı
```
src/
├── main.js
├── preload.js
└── renderer/
    ├── index.html
    ├── app.js
    └── styles.css
```
