package admin

import (
	"reflect"
	"testing"
)

func TestPolicyTags(t *testing.T) {
	cases := []struct {
		name   string
		values []string
		want   []string
	}{
		{"none lists everything", nil, []string{}},
		{"repeated params", []string{"a", "b"}, []string{"a", "b"}},
		{"one comma-separated value from a form", []string{"a, b"}, []string{"a", "b"}},
		{"empty pieces are dropped", []string{"", " , a,"}, []string{"a"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := policyTags(c.values); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("policyTags(%q) = %q, want %q", c.values, got, c.want)
			}
		})
	}
}
