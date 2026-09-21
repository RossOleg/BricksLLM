package proxy

import "testing"

// The point of storing metadata in JSONB is to group and filter by its fields.
// Encoding the header a second time would put a JSON string literal in the
// column instead of a document, and every such query would silently return
// nothing - so what these tests pin down is that the header arrives unchanged.
func TestMetadataFromHeader(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
		ok     bool
	}{
		{
			name:   "an object is stored as it came",
			header: `{"catalog":"Photos","mediaType":"video"}`,
			want:   `{"catalog":"Photos","mediaType":"video"}`,
			ok:     true,
		},
		{
			name:   "an absent header is an empty document, not an error",
			header: "",
			want:   `{}`,
			ok:     true,
		},
		{
			name:   "text that is not JSON is dropped rather than wrapped in a string",
			header: "catalog=Photos",
			want:   `{}`,
			ok:     false,
		},
		{
			name:   "a truncated document is dropped",
			header: `{"catalog":"Photos"`,
			want:   `{}`,
			ok:     false,
		},
		{
			name:   "nested values survive, since the column keeps the whole document",
			header: `{"catalog":"Photos","tags":["a","b"],"n":{"deep":1}}`,
			want:   `{"catalog":"Photos","tags":["a","b"],"n":{"deep":1}}`,
			ok:     true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := metadataFromHeader(tc.header)

			if ok != tc.ok {
				t.Fatalf("accepted = %v, want %v", ok, tc.ok)
			}

			if string(got) != tc.want {
				t.Fatalf("stored %s, want %s", got, tc.want)
			}
		})
	}
}

// A document that has been marshalled twice is exactly the failure this code
// exists to avoid, so it is worth stating that such a value is never produced.
func TestMetadataFromHeaderNeverDoubleEncodes(t *testing.T) {
	got, ok := metadataFromHeader(`{"catalog":"Photos"}`)
	if !ok {
		t.Fatal("a valid document was rejected")
	}

	if got[0] == '"' {
		t.Fatalf("stored a JSON string literal instead of a document: %s", got)
	}
}
